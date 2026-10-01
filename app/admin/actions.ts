"use server";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import {
  StoredAppointment,
  StoredClient,
  DynamicService,
  Expense,
  Promotion,
  Voucher,
  MessageTemplate,
  INITIAL_SERVICES,
} from "@/lib/db";
import { BlockedTime, formatDateKey, timeStringToMinutes } from "@/lib/availability";
import { SERVICIOS_AGAPE, EXTRAS_AGAPE, calculateTotalDuration, calculateTotalPrice } from "@/lib/services";
import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";

export interface DashboardStats {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  totalRevenue: number;
  pendingRevenue: number;
  payments?: {
    cash: number;
    transfer: number;
  };
  popularServices?: {
    name: string;
    count: number;
    revenue: number;
  }[];
}

/**
 * Obtiene todos los turnos del sistema ordenados por fecha y hora
 */
export async function getAdminAppointments(): Promise<StoredAppointment[]> {
  try {
    const apts = await prisma.appointment.findMany({
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      include: { client: true },
    });
    return apts.map((a) => ({
      ...a,
      status: a.status as StoredAppointment["status"],
      paymentStatus: a.paymentStatus as StoredAppointment["paymentStatus"],
      paymentMethod: (a.paymentMethod as StoredAppointment["paymentMethod"]) || undefined,
      paymentReceipt: a.paymentReceipt || undefined,
      notes: a.notes || undefined,
      totalPrice: Number(a.totalPrice),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      clientName: a.clientName || a.client?.name || "Clienta",
      clientPhone: a.clientPhone || a.client?.phone || "",
    }));
  } catch (error) {
    console.error("Error al obtener turnos de administración:", error);
    return [];
  }
}

/**
 * Obtiene los bloqueos manuales de horario
 */
export async function getAdminBlockedTimes(): Promise<BlockedTime[]> {
  try {
    const blocks = await prisma.blockedTime.findMany();
    return blocks.map(b => ({
      ...b,
      reason: b.reason || "Bloqueo",
    }));
  } catch (error) {
    console.error("Error al obtener bloqueos:", error);
    return [];
  }
}

/**
 * Actualiza el estado de un turno (CONFIRMED, COMPLETED, CANCELLED, NO_SHOW)
 */
export async function updateAppointmentStatus(id: string, status: string) {
  try {
    await prisma.appointment.update({
      where: { id },
      data: { status },
    });
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/stats");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: any) {
    console.error("Error al actualizar estado del turno:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Elimina un turno permanentemente
 */
export async function deleteAppointment(id: string) {
  try {
    await prisma.appointment.delete({ where: { id } });
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/stats");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: any) {
    console.error("Error al eliminar turno:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Actualiza el estado de pago o seña de un turno
 */
export async function updateAppointmentPaymentStatus(
  id: string,
  paymentStatus?: string,
  paymentMethod?: string
) {
  try {
    const data: any = { paymentStatus: paymentStatus || "PENDING" };
    if (paymentMethod) data.paymentMethod = paymentMethod;
    await prisma.appointment.update({ where: { id }, data });
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/stats");
    revalidatePath("/admin/finances");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Permite reagendar o modificar fecha/hora/estado de un turno
 */
export async function rescheduleAppointment(
  id: string,
  data: {
    date: string;
    startTime: string;
    status?: string;
    paymentStatus?: string;
    totalPrice?: number;
    notes?: string;
  }
) {
  try {
    const apt = await prisma.appointment.findUnique({ where: { id } });
    if (!apt) return { success: false, error: "Turno no encontrado" };

    const startMinutes = timeStringToMinutes(data.startTime);
    const endMinutes = startMinutes + (apt.durationMinutes || 60);
    const hours = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const minutes = (endMinutes % 60).toString().padStart(2, "0");

    const updateData: any = {
      date: data.date,
      startTime: data.startTime,
      endTime: `${hours}:${minutes}`,
    };
    if (data.status) updateData.status = data.status;
    if (data.paymentStatus) updateData.paymentStatus = data.paymentStatus;
    if (data.totalPrice !== undefined) updateData.totalPrice = Number(data.totalPrice);
    if (data.notes !== undefined) updateData.notes = data.notes;

    await prisma.appointment.update({ where: { id }, data: updateData });

    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Permite a la manicurista crear un turno manual desde el panel
 */
export async function createManualAppointment(data: {
  clientName: string;
  clientPhone: string;
  serviceId?: string;
  serviceName?: string;
  extraIds?: string[];
  date: string; // "YYYY-MM-DD"
  startTime: string; // "15:00"
  totalPrice?: number;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  notes?: string;
}) {
  try {
    // Buscar el servicio en Prisma, o usar fallback
    let serviceInfo = await prisma.dynamicService.findUnique({ where: { id: data.serviceId || "" } });
    if (!serviceInfo) {
      const fallbackService = SERVICIOS_AGAPE.find((s) => s.id === data.serviceId) || SERVICIOS_AGAPE[0];
      serviceInfo = {
        id: fallbackService.id,
        nombre: fallbackService.nombre,
        categoria: fallbackService.categoria,
        precio: fallbackService.precio,
        duracion: fallbackService.duracion,
      } as any;
    }

    const extras = EXTRAS_AGAPE.filter((e) => (data.extraIds || []).includes(e.id));
    const totalDuration = calculateTotalDuration(serviceInfo as any, extras);
    const calculatedPrice = calculateTotalPrice(serviceInfo as any, extras);
    const finalPrice = data.totalPrice !== undefined ? Number(data.totalPrice) : calculatedPrice;

    const startMinutes = timeStringToMinutes(data.startTime);
    const endMinutes = startMinutes + totalDuration;
    const hours = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const minutes = (endMinutes % 60).toString().padStart(2, "0");
    const endTime = `${hours}:${minutes}`;

    let client = await prisma.client.findFirst({ where: { phone: data.clientPhone.trim() } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: data.clientName.trim(),
          phone: data.clientPhone.trim(),
          category: "Nueva",
        },
      });
    }

    const newApt = await prisma.appointment.create({
      data: {
        clientId: client.id,
        clientName: data.clientName.trim(),
        clientPhone: data.clientPhone.trim(),
        serviceId: data.serviceId || serviceInfo!.id,
        serviceName: data.serviceName || serviceInfo!.nombre,
        extraIds: extras.map((e) => e.id),
        extraNames: extras.map((e) => e.nombre),
        date: data.date,
        startTime: data.startTime,
        endTime,
        durationMinutes: totalDuration,
        totalPrice: finalPrice,
        status: data.status || "CONFIRMED",
        paymentStatus: data.paymentStatus || "PENDING",
        paymentMethod: data.paymentMethod || "TRANSFERENCIA",
        notes: data.notes,
      },
    });

    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    return { success: true, appointmentId: newApt.id };
  } catch (error: any) {
    console.error("Error creando turno manual:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Agrega un bloqueo de horario personal en la agenda
 */
export async function addScheduleBlock(data: {
  date: string;
  startTime: string;
  endTime: string;
  reason: string;
}) {
  try {
    await prisma.blockedTime.create({
      data: {
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        reason: data.reason || "Bloqueo personal",
      },
    });
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (error: any) {
    console.error("Error al agregar bloqueo:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Elimina un bloqueo de horario
 */
export async function removeScheduleBlock(id: string) {
  try {
    await prisma.blockedTime.delete({ where: { id } });
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (error: any) {
    console.error("Error al eliminar bloqueo:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Métricas para el panel de administración
 */
export async function getAdminStats(): Promise<DashboardStats> {
  try {
    const apts = await prisma.appointment.findMany();
    const total = apts.length;
    const confirmed = apts.filter((a) => a.status === "CONFIRMED").length;
    const completed = apts.filter((a) => a.status === "COMPLETED").length;
    const cancelled = apts.filter((a) => a.status === "CANCELLED").length;
    const noShow = apts.filter((a) => a.status === "NO_SHOW").length;

    const getCollectedStat = (a: any) => {
      if (a.status === "CANCELLED") return 0;
      if (
        a.paymentStatus === "PENDING" ||
        a.paymentStatus === "DEPOSIT_REQUESTED" ||
        a.paymentStatus === "AWAITING_VERIFICATION"
      ) {
        return 0;
      }
      const price = Number(a.totalPrice) || 0;
      if (a.paymentStatus === "PAID") {
        return price;
      }
      if (a.paymentStatus === "DEPOSIT_PAID") {
        return Math.round(price * 0.5);
      }
      return 0;
    };

    const totalRevenue = apts.reduce((sum, a) => sum + getCollectedStat(a), 0);

    const pendingRevenue = apts
      .filter((a) => a.status !== "CANCELLED" && a.paymentStatus !== "PAID")
      .reduce((sum, a) => {
        const p = Number(a.totalPrice) || 0;
        if (a.paymentStatus === "DEPOSIT_PAID") return sum + Math.round(p * 0.5);
        return sum + p;
      }, 0);

    // Servicios populares
    const serviceMap = new Map<string, { count: number; revenue: number }>();
    apts.forEach((apt) => {
      const name = apt.serviceName || "Servicio";
      const existing = serviceMap.get(name) || { count: 0, revenue: 0 };
      existing.count += 1;
      existing.revenue += Number(apt.totalPrice) || 0;
      serviceMap.set(name, existing);
    });

    const popularServices = Array.from(serviceMap.entries())
      .map(([name, data]) => ({ name, count: data.count, revenue: data.revenue }))
      .sort((a, b) => b.count - a.count);

    return {
      total,
      confirmed,
      completed,
      cancelled,
      noShow,
      totalRevenue,
      pendingRevenue,
      payments: {
        cash: Math.round(totalRevenue * 0.4), // Proporción aproximada
        transfer: Math.round(totalRevenue * 0.6),
      },
      popularServices,
    };
  } catch (error) {
    console.error("Error al obtener estadísticas:", error);
    return {
      total: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
      totalRevenue: 0,
      pendingRevenue: 0,
      payments: { cash: 0, transfer: 0 },
      popularServices: [],
    };
  }
}

/**
 * Alias de compatibilidad para getAdminStats
 */
export const getStats = getAdminStats;

// ==========================================
// 1. GESTIÓN DE SERVICIOS DINÁMICOS
// ==========================================

export async function getAdminServices(): Promise<DynamicService[]> {
  try {
    const services = await prisma.dynamicService.findMany();
    if (services.length > 0) {
      return services.map(s => ({
        ...s,
        imagenUrl: s.imagenUrl || "",
        garantia: s.garantia || "",
        instrucciones: s.instrucciones || "",
      }));
    }
    return INITIAL_SERVICES;
  } catch (error) {
    console.error("Error al obtener servicios de administración:", error);
    return INITIAL_SERVICES;
  }
}

export async function saveAdminService(data: Partial<DynamicService>): Promise<{ success: boolean; error?: string }> {
  try {
    if (data.id) {
      // Editar existente
      const exists = await prisma.dynamicService.findUnique({ where: { id: data.id } });
      if (exists) {
        await prisma.dynamicService.update({
          where: { id: data.id },
          data: {
            nombre: data.nombre,
            categoria: data.categoria,
            precio: data.precio ? Number(data.precio) : undefined,
            duracion: data.duracion ? Number(data.duracion) : undefined,
            mantenimientoDias: data.mantenimientoDias ? Number(data.mantenimientoDias) : undefined,
            descripcion: data.descripcion,
            imagenUrl: data.imagenUrl,
            queIncluye: data.queIncluye,
            queNoIncluye: data.queNoIncluye,
            garantia: data.garantia,
            instrucciones: data.instrucciones,
            activo: data.activo,
            destacado: data.destacado,
          },
        });
      } else {
        await prisma.dynamicService.create({
          data: {
            id: data.id,
            nombre: data.nombre || "Nuevo Servicio",
            categoria: data.categoria || "Manicura",
            precio: Number(data.precio) || 0,
            duracion: Number(data.duracion) || 60,
            mantenimientoDias: Number(data.mantenimientoDias) || 21,
            descripcion: data.descripcion || "",
            imagenUrl: data.imagenUrl || "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=800&q=80",
            queIncluye: data.queIncluye || [],
            queNoIncluye: data.queNoIncluye || [],
            garantia: data.garantia || "5 días de garantía.",
            instrucciones: data.instrucciones || "Asistir con uñas limpias.",
            activo: data.activo !== undefined ? data.activo : true,
            destacado: data.destacado || false,
          },
        });
      }
    } else {
      // Crear nuevo
      await prisma.dynamicService.create({
        data: {
          id: randomUUID(),
          nombre: data.nombre || "Nuevo Servicio",
          categoria: data.categoria || "Manicura",
          precio: Number(data.precio) || 0,
          duracion: Number(data.duracion) || 60,
          mantenimientoDias: Number(data.mantenimientoDias) || 21,
          descripcion: data.descripcion || "",
          imagenUrl: data.imagenUrl || "https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=800&q=80",
          queIncluye: data.queIncluye || [],
          queNoIncluye: data.queNoIncluye || [],
          garantia: data.garantia || "5 días de garantía.",
          instrucciones: data.instrucciones || "Asistir con uñas limpias.",
          activo: data.activo !== undefined ? data.activo : true,
          destacado: data.destacado || false,
        },
      });
    }

    revalidatePath("/admin/services");
    revalidatePath("/servicios");
    revalidatePath("/book");
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    console.error("Error al guardar servicio:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteAdminService(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.dynamicService.delete({ where: { id } });
    revalidatePath("/admin/services");
    revalidatePath("/servicios");
    revalidatePath("/book");
    revalidatePath("/");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function toggleServiceStatus(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const service = await prisma.dynamicService.findUnique({ where: { id } });
    if (service) {
      await prisma.dynamicService.update({
        where: { id },
        data: { activo: !service.activo },
      });
      revalidatePath("/admin/services");
      revalidatePath("/servicios");
      revalidatePath("/book");
      revalidatePath("/");
      return { success: true };
    }
    return { success: false, error: "Servicio no encontrado" };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ==========================================
// 2. FINANZAS: GASTOS, INGRESOS Y RESULTADO
// ==========================================

export async function getAdminExpenses(): Promise<Expense[]> {
  try {
    const expenses = await prisma.expense.findMany({
      orderBy: { fecha: "desc" },
    });
    return expenses.map((e) => ({
      ...e,
      categoria: e.categoria as Expense["categoria"],
      observaciones: e.observaciones || undefined,
      monto: Number(e.monto),
      createdAt: e.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("Error al obtener gastos:", error);
    return [];
  }
}

export async function saveAdminExpense(data: Omit<Expense, "id" | "createdAt">): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.expense.create({
      data: {
        fecha: data.fecha,
        categoria: data.categoria,
        descripcion: data.descripcion,
        monto: Number(data.monto),
        observaciones: data.observaciones,
      },
    });
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteAdminExpense(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.expense.delete({ where: { id } });
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateAdminExpense(
  id: string,
  data: {
    fecha: string;
    categoria: string;
    descripcion: string;
    monto: number;
    observaciones?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    await prisma.expense.update({
      where: { id },
      data: {
        fecha: data.fecha,
        categoria: data.categoria,
        descripcion: data.descripcion,
        monto: Number(data.monto),
        observaciones: data.observaciones || "",
      },
    });
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getFinancialSummary() {
  try {
    const todayStr = formatDateKey(new Date());
    const currentMonth = todayStr.substring(0, 7); // "YYYY-MM"

    // Calcular inicio de semana (lunes)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const mondayStr = formatDateKey(monday);

    const apts = await prisma.appointment.findMany({
      include: { client: true },
    });

    const getCollected = (a: any) => {
      if (a.status === "CANCELLED") return 0;
      const price = Number(a.totalPrice) || 0;
      if (a.paymentStatus === "PAID") return price;
      if (a.paymentStatus === "DEPOSIT_PAID") return Math.round(price * 0.5);
      return 0;
    };

    const incomeApts = apts.filter((a) => getCollected(a) > 0);

    const totalIncome = incomeApts.reduce((sum, a) => sum + getCollected(a), 0);
    const todayIncome = incomeApts.filter((a) => a.date === todayStr).reduce((sum, a) => sum + getCollected(a), 0);
    const weekIncome = incomeApts.filter((a) => a.date >= mondayStr).reduce((sum, a) => sum + getCollected(a), 0);
    const monthIncome = incomeApts.filter((a) => a.date.startsWith(currentMonth)).reduce((sum, a) => sum + getCollected(a), 0);

    const expenses = await prisma.expense.findMany();
    const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.monto) || 0), 0);
    const monthExpenses = expenses.filter((e) => (e.fecha || "").startsWith(currentMonth)).reduce((sum, e) => sum + (Number(e.monto) || 0), 0);

    const cashIncome = incomeApts
      .filter((a) => a.paymentMethod === "EFECTIVO" || a.paymentMethod === "CASH")
      .reduce((sum, a) => sum + getCollected(a), 0);
    const transferIncome = incomeApts
      .filter((a) => a.paymentMethod === "TRANSFERENCIA" || a.paymentMethod === "TRANSFER" || !a.paymentMethod)
      .reduce((sum, a) => sum + getCollected(a), 0);

    const netResult = totalIncome - totalExpenses;
    const monthResult = monthIncome - monthExpenses;

    const incomeBreakdown = incomeApts.map((a) => {
      const isDeposit = a.paymentStatus === "DEPOSIT_PAID";
      return {
        id: a.id,
        clientName: a.clientName || a.client?.name || "Clienta",
        serviceName: a.serviceName || "Servicio Ágape",
        date: a.date,
        startTime: a.startTime || "10:00",
        paymentStatus: a.paymentStatus || "PAID",
        paymentMethod: a.paymentMethod || "TRANSFERENCIA",
        totalPrice: Number(a.totalPrice) || 0,
        collectedAmount: getCollected(a),
        type: isDeposit ? "Seña 50%" : "Pago Total 100%",
      };
    });

    return {
      totalIncome,
      todayIncome,
      weekIncome,
      monthIncome,
      totalExpenses,
      monthExpenses,
      netResult,
      monthResult,
      cashIncome,
      transferIncome,
      appointmentsCount: incomeApts.length,
      incomeBreakdown,
    };
  } catch (error) {
    console.error("Error calculando balance financiero:", error);
    return {
      totalIncome: 0, todayIncome: 0, weekIncome: 0, monthIncome: 0,
      totalExpenses: 0, monthExpenses: 0, netResult: 0, monthResult: 0,
      cashIncome: 0, transferIncome: 0, appointmentsCount: 0, incomeBreakdown: [],
    };
  }
}

// ==========================================
// 3. PAGOS, SEÑAS Y REPROGRAMACIÓN DE TURNOS
// ==========================================

export async function updateAppointmentPayment(
  id: string,
  paymentStatus?: string,
  paymentMethod?: string,
  paymentReceipt?: string,
  status?: string,
  totalPrice?: number
) {
  try {
    const data: any = { paymentStatus: paymentStatus || "PENDING" };
    if (paymentMethod) {
      data.paymentMethod = paymentMethod === "CASH" ? "EFECTIVO" : paymentMethod === "TRANSFER" ? "TRANSFERENCIA" : paymentMethod;
    }
    if (paymentReceipt !== undefined) data.paymentReceipt = paymentReceipt;
    if (status !== undefined) data.status = status;
    if (totalPrice !== undefined) data.totalPrice = Number(totalPrice);

    await prisma.appointment.update({ where: { id }, data });
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/finances");
    revalidatePath("/admin/stats");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function rescheduleAdminAppointment(
  id: string,
  newDate: string,
  newStartTime: string
) {
  try {
    const apt = await prisma.appointment.findUnique({ where: { id } });
    if (!apt) return { success: false, error: "Turno no encontrado" };

    const startMinutes = timeStringToMinutes(newStartTime);
    const endMinutes = startMinutes + apt.durationMinutes;
    const hours = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const minutes = (endMinutes % 60).toString().padStart(2, "0");

    await prisma.appointment.update({
      where: { id },
      data: {
        date: newDate,
        startTime: newStartTime,
        endTime: `${hours}:${minutes}`,
      },
    });

    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ==========================================
// 4. CLIENTAS, CUMPLEAÑOS Y CLIENTAS INACTIVAS
// ==========================================

export async function getAdminClientsEnhanced() {
  try {
    const today = new Date();
    const todayStr = formatDateKey(today);

    const clients = await prisma.client.findMany({
      include: {
        appointments: true,
      },
    });

    return clients.map((client) => {
      const completed = client.appointments.filter((a) => a.status === "COMPLETED");
      const sortedApts = [...client.appointments].sort((a, b) => b.date.localeCompare(a.date));
      const lastApt = sortedApts[0];

      let daysSinceLastVisit: number | undefined = undefined;
      if (lastApt) {
        const lastDate = new Date(lastApt.date);
        const diffMs = today.getTime() - lastDate.getTime();
        daysSinceLastVisit = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }

      let isBirthdaySoon = false;
      if (client.birthday) {
        let bMonth = 0;
        let bDay = 0;
        if (client.birthday.includes("-")) {
          const parts = client.birthday.split("-");
          bMonth = parseInt(parts[1], 10) - 1;
          bDay = parseInt(parts[2], 10);
        } else if (client.birthday.includes("/")) {
          const parts = client.birthday.split("/");
          bDay = parseInt(parts[0], 10);
          bMonth = parseInt(parts[1], 10) - 1;
        }

        if (bDay > 0) {
          const bDateThisYear = new Date(today.getFullYear(), bMonth, bDay);
          const diffDays = Math.ceil((bDateThisYear.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= 15) {
            isBirthdaySoon = true;
          }
        }
      }

      return {
        id: client.id,
        name: client.name,
        phone: client.phone,
        category: client.category as "Nueva" | "Recurrente" | "Frecuente" | "VIP" | undefined,
        birthday: client.birthday || undefined,
        notes: client.notes || undefined,
        createdAt: client.createdAt.toISOString(),
        totalVisits: client.totalVisits,
        technicalRecord: client.technicalRecord as any,
        appointmentsCount: client.appointments.length,
        completedCount: completed.length,
        lastVisit: lastApt?.date,
        lastService: lastApt?.serviceName,
        daysSinceLastVisit,
        isBirthdaySoon,
      };
    });
  } catch (error) {
    console.error("Error obteniendo clientas desde Prisma:", error);
    return [];
  }
}

export async function updateClientDetails(
  id: string,
  data: {
    name?: string;
    phone?: string;
    birthday?: string;
    category?: string;
    notes?: string;
  }
) {
  try {
    const updateData: any = {};
    if (data.name) updateData.name = data.name.trim();
    if (data.phone) updateData.phone = data.phone.trim();
    if (data.birthday !== undefined) updateData.birthday = data.birthday.trim() || null;
    if (data.category) updateData.category = data.category;
    if (data.notes !== undefined) updateData.notes = data.notes.trim() || null;

    await prisma.client.update({
      where: { id },
      data: updateData,
    });

    revalidatePath("/admin/clients");
    return { success: true };
  } catch (error: any) {
    console.error("Error al actualizar clienta:", error);
    return { success: false, error: error?.message || "Error al actualizar" };
  }
}

export async function deleteClient(id: string) {
  try {
    // Delete all appointments associated with this client first
    await prisma.appointment.deleteMany({
      where: { clientId: id },
    });

    await prisma.client.delete({
      where: { id },
    });
    revalidatePath("/admin/clients");
    return { success: true };
  } catch (error: any) {
    console.error("Error eliminando cliente en Prisma:", error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// 5. PROMOCIONES Y VOUCHERS DE REGALO
// ==========================================

export async function getAdminPromotions(): Promise<Promotion[]> {
  try {
    const promos = await prisma.promotion.findMany();
    return promos.map(p => ({
      ...p,
      descuentoPorcentaje: p.descuentoPorcentaje || undefined,
      precioPromo: Number(p.precioPromo),
      createdAt: p.createdAt.toISOString()
    }));
  } catch (error) {
    return [];
  }
}

export async function saveAdminPromotion(data: Partial<Promotion>): Promise<{ success: boolean; error?: string }> {
  try {
    if (data.id) {
      const exists = await prisma.promotion.findUnique({ where: { id: data.id } });
      if (exists) {
        await prisma.promotion.update({
          where: { id: data.id },
          data: {
            nombre: data.nombre,
            descripcion: data.descripcion,
            descuentoPorcentaje: data.descuentoPorcentaje,
            precioPromo: data.precioPromo ? Number(data.precioPromo) : undefined,
            fechaInicio: data.fechaInicio,
            fechaFin: data.fechaFin,
            serviciosIds: data.serviciosIds,
            activo: data.activo,
          },
        });
      }
    } else {
      await prisma.promotion.create({
        data: {
          nombre: data.nombre || "Promoción Especial",
          descripcion: data.descripcion || "",
          descuentoPorcentaje: data.descuentoPorcentaje,
          precioPromo: Number(data.precioPromo) || 0,
          fechaInicio: data.fechaInicio || formatDateKey(new Date()),
          fechaFin: data.fechaFin || formatDateKey(new Date(Date.now() + 15 * 86400000)),
          serviciosIds: data.serviciosIds || [],
          activo: data.activo !== undefined ? data.activo : true,
        },
      });
    }
    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteAdminPromotion(id: string) {
  try {
    await prisma.promotion.delete({ where: { id } });
    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function getAdminVouchers(): Promise<Voucher[]> {
  try {
    const vouchers = await prisma.voucher.findMany({
      orderBy: { createdAt: "desc" },
    });
    return vouchers.map(v => ({
      ...v,
      estado: v.estado as Voucher["estado"],
      monto: v.monto ? Number(v.monto) : undefined,
      createdAt: v.createdAt.toISOString(),
    }));
  } catch (error) {
    return [];
  }
}

export async function createAdminVoucher(data: {
  para: string;
  de: string;
  servicioONombre: string;
  monto?: number;
  vencimiento: string;
}) {
  try {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const codigo = `AGAPE-${randomSuffix}`;

    const newVoucher = await prisma.voucher.create({
      data: {
        codigo,
        para: data.para.trim(),
        de: data.de.trim(),
        servicioONombre: data.servicioONombre.trim(),
        monto: data.monto ? Number(data.monto) : undefined,
        vencimiento: data.vencimiento,
        estado: "DISPONIBLE",
      },
    });

    revalidatePath("/admin/promotions");
    return {
      success: true,
      voucher: {
        ...newVoucher,
        estado: newVoucher.estado as Voucher["estado"],
        monto: newVoucher.monto ? Number(newVoucher.monto) : undefined,
        createdAt: newVoucher.createdAt.toISOString()
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateVoucherStatus(id: string, estado: string) {
  try {
    await prisma.voucher.update({
      where: { id },
      data: { estado },
    });
    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteAdminVoucher(id: string) {
  try {
    await prisma.voucher.delete({ where: { id } });
    revalidatePath("/admin/promotions");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ==========================================
// 6. PLANTILLAS DE MENSAJES DE WHATSAPP
// ==========================================

export async function getAdminTemplates(): Promise<MessageTemplate[]> {
  try {
    const templates = await prisma.messageTemplate.findMany();
    return templates.map(t => ({
      ...t,
      tipo: t.tipo as MessageTemplate["tipo"],
    }));
  } catch (error) {
    return [];
  }
}

export async function saveAdminTemplate(id: string, texto: string) {
  try {
    await prisma.messageTemplate.update({
      where: { id },
      data: { texto },
    });
    revalidatePath("/admin/messages");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}


export async function getAdminExtras() {
  try {
    const extras = await prisma.dynamicExtra.findMany();
    if (extras.length > 0) return extras;
    return EXTRAS_AGAPE;
  } catch (error) {
    return EXTRAS_AGAPE;
  }
}

export async function saveAdminExtra(data: any) {
  try {
    if (data.id && data.id.length > 5) { // UUID
      const exists = await prisma.dynamicExtra.findUnique({ where: { id: data.id } });
      if (exists) {
        await prisma.dynamicExtra.update({
          where: { id: data.id },
          data: {
            nombre: data.nombre,
            precio: Number(data.precio),
            duracion: Number(data.duracion),
            descripcion: data.descripcion,
            activo: data.activo
          }
        });
      } else {
        await prisma.dynamicExtra.create({
          data: {
            id: data.id,
            nombre: data.nombre,
            precio: Number(data.precio),
            duracion: Number(data.duracion),
            descripcion: data.descripcion,
            activo: data.activo !== undefined ? data.activo : true
          }
        });
      }
    } else {
      await prisma.dynamicExtra.create({
        data: {
          id: randomUUID(),
          nombre: data.nombre,
          precio: Number(data.precio),
          duracion: Number(data.duracion),
          descripcion: data.descripcion,
          activo: data.activo !== undefined ? data.activo : true
        }
      });
    }
    revalidatePath("/admin/services");
    revalidatePath("/servicios");
    revalidatePath("/book");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteAdminExtra(id: string) {
  try {
    await prisma.dynamicExtra.delete({ where: { id } });
    revalidatePath("/admin/services");
    revalidatePath("/servicios");
    revalidatePath("/book");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function toggleExtraStatus(id: string) {
  try {
    const extra = await prisma.dynamicExtra.findUnique({ where: { id } });
    if (extra) {
      await prisma.dynamicExtra.update({
        where: { id },
        data: { activo: !extra.activo }
      });
      revalidatePath("/admin/services");
      revalidatePath("/servicios");
      revalidatePath("/book");
      revalidatePath("/");
      return { success: true };
    }
    return { success: false };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
