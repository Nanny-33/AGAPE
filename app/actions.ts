"use server";

import { PrismaClient } from "@prisma/client";
import {
  calculateAvailableSlots,
  formatDateKey,
  timeStringToMinutes,
  TimeInterval,
  SlotAvailability,
  DaySchedule,
  SpecialOpening,
  BlockedTime,
  DEFAULT_WEEKLY_SCHEDULE,
} from "@/lib/availability";
import {
  INITIAL_SERVICES,
  StoredAppointment,
} from "@/lib/db";
import { SERVICIOS_AGAPE, EXTRAS_AGAPE } from "@/lib/services";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { unstable_noStore as noStore } from "next/cache";

const prisma = new PrismaClient();

/**
 * Obtiene la disponibilidad horaria calculada para un día y duración determinados
 * Evita cualquier tipo de solapamiento con turnos existentes, descansos o bloqueos.
 */
export async function getCalculatedAvailability(
  dateString: string, // "YYYY-MM-DD"
  totalDurationMinutes: number = 90
): Promise<{
  success: boolean;
  slots: SlotAvailability[];
  date: string;
  isClosedDay?: boolean;
}> {
  try {
    const [year, month, day] = dateString.split("-").map(Number);
    const targetDate = new Date(year, month - 1, day);

    // Consultar paralelamente a Prisma
    const [dayAppointments, blockedTimes, specialOpenings, weeklySchedule] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          date: dateString,
          status: { not: "CANCELLED" },
        },
      }),
      prisma.blockedTime.findMany(),
      prisma.specialOpening.findMany(),
      prisma.daySchedule.findMany(),
    ]);

    // Convertir los turnos a intervalos ocupados en minutos
    const busyIntervals: TimeInterval[] = dayAppointments.map((apt) => ({
      startMinutes: timeStringToMinutes(apt.startTime),
      endMinutes: timeStringToMinutes(apt.endTime),
      reason: "TURNO_EXISTENTE",
      title: `${apt.serviceName} (${apt.clientName})`,
    }));

    // Convertir DaySchedule a array compatible con lib/availability
    const DAYS_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    
    // Si la base de datos tiene todos los días cerrados (isOpen = false para todos) o no tiene registros
    // asumimos que el horario no ha sido configurado y usamos el por defecto.
    const isScheduleConfigured = weeklySchedule.some(ws => ws.isOpen);
    
    let finalSchedule = DEFAULT_WEEKLY_SCHEDULE;
    
    if (isScheduleConfigured) {
      const formattedSchedule = weeklySchedule.map((ws) => ({
        dayOfWeek: ws.dayOfWeek,
        nombreDia: DAYS_NAMES[ws.dayOfWeek] || "Desconocido",
        isWorkingDay: ws.isOpen,
        hours: {
          open: ws.openTime || "09:00",
          close: ws.closeTime || "18:00",
          hasBreak: !!(ws.breakStart && ws.breakEnd),
          breakStart: ws.breakStart || undefined,
          breakEnd: ws.breakEnd || undefined,
        }
      }));

      // Asegurar que siempre haya 7 días combinando la BD con los valores por defecto
      finalSchedule = DEFAULT_WEEKLY_SCHEDULE.map((defaultDay) => {
        const dbDay = formattedSchedule.find((d) => d.dayOfWeek === defaultDay.dayOfWeek);
        return dbDay || defaultDay;
      });
    }

    // Ejecutar el motor de disponibilidad matemática
    const slots = calculateAvailableSlots({
      date: targetDate,
      totalDurationMinutes,
      busyIntervals,
      blockedTimes: blockedTimes.map(b => ({ ...b, reason: b.reason || "" })),
      specialOpenings: specialOpenings.map(s => ({ ...s, reason: s.reason || "", open: s.startTime, close: s.endTime })),
      weeklySchedule: finalSchedule,
      slotStepMinutes: 30,
    });

    return {
      success: true,
      slots,
      date: dateString,
      isClosedDay: slots.length === 0,
    };
  } catch (error: any) {
    console.error("Error al calcular disponibilidad:", error);
    return {
      success: false,
      slots: [],
      date: dateString,
    };
  }
}

/**
 * Registra un nuevo turno en el sistema de ÁGAPE STUDIO
 */
export async function bookAgapeAppointment(data: {
  name: string;
  phone: string;
  serviceId: string;
  extraIds: string[];
  date: string; // "YYYY-MM-DD"
  startTime: string; // "15:00"
  notes?: string;
}): Promise<{ success: boolean; appointmentId?: string; error?: string }> {
  try {
    // 1. Buscar servicio principal
    const service = await prisma.dynamicService.findUnique({
      where: { id: data.serviceId },
    });
    
    // Fallback si no está en Prisma (por ejemplo, kapping antiguo o recien creado sin migrar todo)
    let finalService = service;
    if (!finalService) {
      const fallback = SERVICIOS_AGAPE.find((s) => s.id === data.serviceId);
      if (fallback) {
        finalService = {
          id: fallback.id,
          nombre: fallback.nombre,
          categoria: fallback.categoria,
          precio: fallback.precio,
          duracion: fallback.duracion,
          mantenimientoDias: fallback.mantenimientoDias,
          descripcion: fallback.descripcion || "",
          imagenUrl: fallback.imagenUrl || null,
          queIncluye: fallback.queIncluye,
          queNoIncluye: fallback.queNoIncluye,
          garantia: fallback.garantia || null,
          instrucciones: fallback.instrucciones || null,
          activo: fallback.activo,
          destacado: fallback.destacado ?? false,
        };
      } else {
        return { success: false, error: "El servicio seleccionado no existe o no está activo." };
      }
    }

    // 2. Buscar extras
    let allExtras: any[] = await prisma.dynamicExtra.findMany();
    if (!allExtras || allExtras.length === 0) {
      allExtras = EXTRAS_AGAPE as any[];
    }
    const extras = allExtras.filter((e) => data.extraIds.includes(e.id));
    const extrasDuration = extras.reduce((acc, curr) => acc + curr.duracion, 0);
    const extrasPrice = extras.reduce((acc, curr) => acc + curr.precio, 0);

    const totalDuration = finalService.duracion + extrasDuration;
    const totalPrice = finalService.precio + extrasPrice;

    // Calcular hora de fin
    const startMinutes = timeStringToMinutes(data.startTime);
    const endMinutes = startMinutes + totalDuration;
    const hours = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const minutes = (endMinutes % 60).toString().padStart(2, "0");
    const endTime = `${hours}:${minutes}`;

    // 3. Validar que el horario sigue libre (prevención de condiciones de carrera)
    const availabilityCheck = await getCalculatedAvailability(data.date, totalDuration);
    const targetSlot = availabilityCheck.slots.find((s) => s.time === data.startTime);

    if (!targetSlot || !targetSlot.available) {
      return {
        success: false,
        error: "El horario seleccionado ya no se encuentra disponible. Por favor elige otro horario.",
      };
    }

    // 4. Buscar o crear clienta
    let client = await prisma.client.findFirst({
      where: { phone: data.phone.trim() },
    });
    
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: data.name.trim(),
          phone: data.phone.trim(),
          category: "Nueva",
        },
      });
    } else {
      // Actualizar nombre si cambió
      if (client.name !== data.name.trim()) {
        client = await prisma.client.update({
          where: { id: client.id },
          data: { name: data.name.trim() },
        });
      }
    }

    // 5. Crear el turno
    const appointmentId = randomUUID();
    await prisma.appointment.create({
      data: {
        id: appointmentId,
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone,
        serviceId: finalService.id,
        serviceName: finalService.nombre,
        extraIds: extras.map((e) => e.id),
        extraNames: extras.map((e) => e.nombre),
        date: data.date,
        startTime: data.startTime,
        endTime,
        durationMinutes: totalDuration,
        totalPrice,
        status: "CONFIRMED",
        notes: data.notes,
      },
    });

    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    revalidatePath("/admin/clients");

    return { success: true, appointmentId };
  } catch (error: any) {
    console.error("Error al registrar turno:", error);
    return { success: false, error: error?.message || "Ocurrió un error inesperado al procesar la reserva." };
  }
}

/**
 * Obtiene los detalles de un turno por su ID
 */
export async function getAppointment(id: string): Promise<StoredAppointment | null> {
  try {
    const apt = await prisma.appointment.findUnique({
      where: { id },
      include: { client: true },
    });
    if (!apt) return null;
    return {
      ...apt,
      status: apt.status as StoredAppointment["status"],
      paymentStatus: apt.paymentStatus as StoredAppointment["paymentStatus"],
      paymentMethod: (apt.paymentMethod as StoredAppointment["paymentMethod"]) || undefined,
      paymentReceipt: apt.paymentReceipt || undefined,
      notes: apt.notes || undefined,
      totalPrice: Number(apt.totalPrice),
      createdAt: apt.createdAt.toISOString(),
      updatedAt: apt.updatedAt.toISOString(),
      clientName: apt.clientName || apt.client?.name || "Clienta",
      clientPhone: apt.clientPhone || apt.client?.phone || "",
    };
  } catch (error) {
    console.error("Error al obtener turno:", error);
    return null;
  }
}

// Alias de compatibilidad para evitar roturas
export const getAgapeAppointmentById = getAppointment;
export const getAppointmentById = getAppointment;

export async function getAvailability(date: Date): Promise<Record<string, number>> {
  try {
    const dateKey = formatDateKey(new Date(date));
    const result = await getCalculatedAvailability(dateKey, 60);
    const availability: Record<string, number> = {};
    result.slots.forEach((s) => {
      if (!s.available) {
        availability[s.time] = 1;
      }
    });
    return availability;
  } catch {
    return {};
  }
}

export async function bookAppointment(data: {
  name: string;
  phone: string;
  date: Date;
}): Promise<{ success: boolean; appointmentId?: string; error?: string }> {
  try {
    const d = new Date(data.date);
    const dateStr = formatDateKey(d);
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    const startTime = `${h}:${m}`;
    return await bookAgapeAppointment({
      name: data.name,
      phone: data.phone,
      serviceId: "kapping",
      extraIds: [],
      date: dateStr,
      startTime,
    });
  } catch (error: any) {
    return { success: false, appointmentId: undefined, error: error.message };
  }
}

export async function getStudioSettings() {
  const envPhone = (process.env.NEXT_PUBLIC_WHATSAPP_PHONE_NUMBER || process.env.WHATSAPP_PHONE_NUMBER || "").replace(/\D/g, "");
  try {
    const settings = await prisma.studioSettings.findFirst();
    if (settings) {
      return {
        studioName: settings.studioName || "ÁGAPE STUDIO",
        whatsappPhone: envPhone || settings.whatsappPhone || "",
        depositPolicy: settings.depositPolicy || "Tolerancia máxima de 15 minutos de espera.",
        enableInShopBooking: settings.enableInShopBooking ?? true,
        enableAtHomeBooking: settings.enableAtHomeBooking ?? true,
      };
    }
  } catch (e) {
    console.error(e);
  }
  return {
    studioName: "ÁGAPE STUDIO",
    whatsappPhone: envPhone || "",
    depositPolicy: "Tolerancia máxima de 15 minutos de espera.",
    enableInShopBooking: true,
    enableAtHomeBooking: true,
  };
}

export async function updateStudioSettings(data: { 
  whatsappPhone?: string; 
  enableInShopBooking?: boolean; 
  enableAtHomeBooking?: boolean; 
}) {
  try {
    const settings = await prisma.studioSettings.findFirst();
    
    const updateData: any = {};
    if (data.whatsappPhone !== undefined) updateData.whatsappPhone = data.whatsappPhone.trim();
    if (data.enableInShopBooking !== undefined) updateData.enableInShopBooking = data.enableInShopBooking;
    if (data.enableAtHomeBooking !== undefined) updateData.enableAtHomeBooking = data.enableAtHomeBooking;

    if (settings) {
      await prisma.studioSettings.update({
        where: { id: settings.id },
        data: updateData,
      });
    } else {
      await prisma.studioSettings.create({
        data: {
          studioName: "ÁGAPE STUDIO",
          whatsappPhone: data.whatsappPhone?.trim() || "",
          depositPolicy: "Tolerancia máxima de 15 minutos de espera.",
          enableInShopBooking: data.enableInShopBooking ?? true,
          enableAtHomeBooking: data.enableAtHomeBooking ?? true,
        },
      });
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getPublicServices() {
  noStore();
  try {
    const totalCount = await prisma.dynamicService.count();
    if (totalCount > 0) {
      return await prisma.dynamicService.findMany({
        where: { activo: true },
      });
    }
    return SERVICIOS_AGAPE.filter((s) => s.activo);
  } catch (error) {
    console.error("Error al obtener servicios públicos:", error);
    return SERVICIOS_AGAPE.filter((s) => s.activo);
  }
}





// GALLERY ACTIONS
export async function getGalleryImages() {
  try {
    return await prisma.galleryImage.findMany({ orderBy: { createdAt: 'desc' } });
  } catch (error) {
    console.error('Error fetching gallery images:', error);
    return [];
  }
}

export async function uploadGalleryImage(url: string, name?: string) {
  try {
    const image = await prisma.galleryImage.create({
      data: { url, name }
    });
    return { success: true, image };
  } catch (error: any) {
    console.error('Error uploading gallery image:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteGalleryImage(id: string) {
  try {
    await prisma.galleryImage.delete({ where: { id } });
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting gallery image:', error);
    return { success: false, error: error.message };
  }
}


export async function getPublicExtras() {
  noStore();
  try {
    const totalCount = await prisma.dynamicExtra.count();
    if (totalCount > 0) {
      return await prisma.dynamicExtra.findMany({
        where: { activo: true },
      });
    }
    return EXTRAS_AGAPE.filter((s) => s.activo);
  } catch (error) {
    console.error("Error al obtener extras publicos:", error);
    return EXTRAS_AGAPE.filter((s) => s.activo);
  }
}
