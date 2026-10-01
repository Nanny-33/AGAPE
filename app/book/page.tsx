"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import {
  SERVICIOS_AGAPE,
  EXTRAS_AGAPE,
  Service,
  Extra,
  calculateTotalDuration,
  calculateTotalPrice,
  formatPrice,
  formatDuration,
} from "@/lib/services";
import { SlotAvailability, formatDateKey, timeStringToMinutes } from "@/lib/availability";
import { getCalculatedAvailability, bookAgapeAppointment, getPublicServices, getStudioSettings, getPublicExtras } from "../actions";
import {
  Calendar as CalendarIcon,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  User,
  Phone,
  FileText,
  Check,
} from "lucide-react";
import { format, isBefore, startOfToday } from "date-fns";
import { es } from "date-fns/locale";

function BookContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // 1. Estado de Servicio y Extras
  const initialServiceId = searchParams.get("service") || "kapping";
  const initialExtraIds = searchParams.get("extras")
    ? searchParams.get("extras")!.split(",")
    : [];

  const [servicesList, setServicesList] = useState<Service[]>(SERVICIOS_AGAPE);
  const [extrasList, setExtrasList] = useState<Extra[]>(EXTRAS_AGAPE);
  const [selectedService, setSelectedService] = useState<Service>(() => {
    return (
      SERVICIOS_AGAPE.find((s) => s.id === initialServiceId) ||
      SERVICIOS_AGAPE[0]
    );
  });
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>(initialExtraIds);

  useEffect(() => {
    getPublicServices().then((list) => {
      if (list) {
        setServicesList(list as Service[]);
        const paramId = searchParams.get("service");
        const found = list.find((s) => s.id === paramId);
        if (found) {
          setSelectedService(found as Service);
        } else if (list.length > 0) {
          setSelectedService(list[0] as Service);
        }
      }
    });
    getPublicExtras().then((list) => {
      if (list) {
        setExtrasList(list as Extra[]);
      }
    });
  }, [searchParams]);

  // 2. Estado de Fecha y Horario
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    return new Date();
  });

  const [selectedSlot, setSelectedSlot] = useState<SlotAvailability | null>(null);
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [isClosedDay, setIsClosedDay] = useState(false);

  // 3. Formulario de Datos
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 4. Ubicación de Atención
  const [locationType, setLocationType] = useState<"LOCAL" | "DOMICILIO">("LOCAL");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [addressNeighborhood, setAddressNeighborhood] = useState("");
  const [addressInfo, setAddressInfo] = useState("");

  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    getStudioSettings().then((res) => {
      setSettings(res);
      if (res.enableInShopBooking && !res.enableAtHomeBooking) {
        setLocationType("LOCAL");
      } else if (!res.enableInShopBooking && res.enableAtHomeBooking) {
        setLocationType("DOMICILIO");
      }
    });
  }, []);

  // Extras seleccionados
  const selectedExtras = extrasList.filter((e) =>
    selectedExtraIds.includes(e.id)
  );
  const totalDuration = calculateTotalDuration(selectedService, selectedExtras);
  const totalPrice = calculateTotalPrice(selectedService, selectedExtras);

  // Cargar disponibilidad cada vez que cambia la fecha o la duración total
  useEffect(() => {
    if (!selectedDate) return;

    const dateKey = formatDateKey(selectedDate);
    setLoadingSlots(true);
    setSelectedSlot(null);
    setErrorMessage(null);

    getCalculatedAvailability(dateKey, totalDuration)
      .then((res) => {
        if (res.success) {
          setSlots(res.slots);
          setIsClosedDay(Boolean(res.isClosedDay));
        } else {
          setSlots([]);
        }
      })
      .catch((err) => {
        console.error("Error consultando disponibilidad:", err);
        setSlots([]);
      })
      .finally(() => {
        setLoadingSlots(false);
      });
  }, [selectedDate, totalDuration]);

  const toggleExtra = (id: string) => {
    setSelectedExtraIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate || !selectedSlot) {
      setErrorMessage("Por favor selecciona una fecha y un horario disponible.");
      return;
    }

    if (!name.trim() || name.trim().length < 2) {
      setErrorMessage("Por favor ingresa tu nombre completo.");
      return;
    }

    if (!phone.trim() || phone.trim().length < 8) {
      setErrorMessage("Por favor ingresa un número de teléfono válido para WhatsApp.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      let finalNotes = notes.trim();
      if (locationType === "DOMICILIO") {
        if (!addressStreet.trim() || !addressNumber.trim() || !addressNeighborhood.trim()) {
          setErrorMessage("Por favor completa los datos obligatorios de tu domicilio (calle, altura y barrio).");
          setSubmitting(false);
          return;
        }
        finalNotes = `ATENCIÓN A DOMICILIO\nCalle: ${addressStreet.trim()} ${addressNumber.trim()}\nBarrio: ${addressNeighborhood.trim()}\nInfo extra: ${addressInfo.trim()}\n\nObservaciones: ${finalNotes}`;
      } else {
        finalNotes = finalNotes ? `ATENCIÓN EN LOCAL\n\nObservaciones: ${finalNotes}` : `ATENCIÓN EN LOCAL`;
      }

      const dateKey = formatDateKey(selectedDate);
      const res = await bookAgapeAppointment({
        name: name.trim(),
        phone: phone.trim(),
        serviceId: selectedService.id,
        extraIds: selectedExtraIds,
        date: dateKey,
        startTime: selectedSlot.time,
        notes: finalNotes,
      });

      if (res.success && res.appointmentId) {
        if (typeof window !== "undefined") {
          try {
            const endMin = timeStringToMinutes(selectedSlot.time) + totalDuration;
            const endH = Math.floor(endMin / 60).toString().padStart(2, "0");
            const endM = (endMin % 60).toString().padStart(2, "0");
            const aptBackup = {
              id: res.appointmentId,
              clientName: name.trim(),
              clientPhone: phone.trim(),
              serviceName: selectedService.nombre,
              extraNames: extrasList.filter((e) => selectedExtraIds.includes(e.id)).map((e) => e.nombre),
              date: dateKey,
              startTime: selectedSlot.time,
              endTime: `${endH}:${endM}`,
              totalPrice,
              durationMinutes: totalDuration,
              status: "CONFIRMED",
            };
            sessionStorage.setItem(`agape_apt_${res.appointmentId}`, JSON.stringify(aptBackup));
          } catch (_) {}
        }
        router.push(`/book/confirmation?id=${res.appointmentId}`);
      } else {
        setErrorMessage(res.error || "No se pudo concretar la reserva.");
        // Refrescar disponibilidad
        const refreshed = await getCalculatedAvailability(dateKey, totalDuration);
        setSlots(refreshed.slots);
      }
    } catch (err: any) {
      setErrorMessage("Ocurrió un error de red al procesar tu reserva.");
    } finally {
      setSubmitting(false);
    }
  };

  const availableSlots = slots.filter((s) => s.available);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Encabezado */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#181818] border border-[#333333] shadow-md text-xs text-[#E0E0E0] mb-3">
          <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
          <span className="font-semibold text-[10px] tracking-wider uppercase">
            Sistema de Turnos Online
          </span>
        </div>
        <h1 className="font-cinzel text-3xl sm:text-4xl font-bold tracking-wider text-[#171717] dark:text-[#FFFFFF] mb-2 uppercase">
          Reserva tu Experiencia en el Estudio
        </h1>
        <p className="text-xs sm:text-sm text-[#666666] dark:text-[#B0B0B0] font-light">
          Selecciona tu servicio, elige el día y el horario libre que mejor se adapte a tu rutina.
        </p>
      </div>

      <form onSubmit={handleBookingSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* COLUMNA IZQUIERDA: PASO 1, 2 y 3 */}
        <div className="lg:col-span-2 space-y-8">
          {/* PASO 1: SERVICIO & EXTRAS */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#FFFFFF] dark:bg-[#141414]/80 border border-[#E2DBD0] dark:border-white/10 backdrop-blur-md shadow-xl text-[#171717] dark:text-white transition-colors duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-full bg-[#D4AF37] text-[#121212] text-xs font-bold flex items-center justify-center">
                1
              </div>
              <div>
                <h2 className="font-cinzel text-lg sm:text-xl font-bold text-[#171717] dark:text-[#FFFFFF]">
                  Elige tu Servicio Principal
                </h2>
                <p className="text-xs text-[#737373] dark:text-[#A3A3A3] font-light">
                  Cada servicio tiene una duración base para asegurar máxima prolijidad.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {servicesList.map((service) => {
                const isSelected = selectedService.id === service.id;
                return (
                  <div
                    key={service.id}
                    onClick={() => setSelectedService(service)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex gap-3.5 items-center ${
                      isSelected
                        ? "bg-[#FFFDF9] dark:bg-[#252119] text-[#171717] dark:text-[#FFFFFF] border-2 border-[#D4AF37] shadow-md"
                        : "bg-[#FAF8F5] dark:bg-[#1A1A1A] text-[#171717] dark:text-[#E5E5E5] border border-[#E2DBD0] dark:border-[#2D2D2D] hover:border-[#D4AF37]/50"
                    }`}
                  >
                    {service.imagenUrl && (
                      <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-[#EFEBE4] dark:bg-[#121212] border border-[#E2DBD0] dark:border-[#262626]">
                        <img
                          src={service.imagenUrl}
                          alt={service.nombre}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-cinzel text-xs sm:text-sm font-semibold leading-tight text-[#171717] dark:text-white">
                          {service.nombre}
                        </span>
                        <span className="text-xs font-bold text-[#B38E22] dark:text-[#D4AF37] whitespace-nowrap">
                          {formatPrice(service.precio)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] mt-2 opacity-80">
                        <span className="px-2 py-0.5 rounded-full bg-[#F3EFEA] dark:bg-[#242424] text-[#A27B2C] dark:text-[#D4AF37] text-[9px] font-semibold border border-[#E2DBD0] dark:border-[#333333]">
                          {service.categoria}
                        </span>
                        <span className="flex items-center gap-1 text-[#737373] dark:text-[#A3A3A3]">
                          <Clock className="w-3 h-3 text-[#B38E22] dark:text-[#D4AF37]" />
                          {service.duracion} min
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Extras opcionales */}
            <div className="border-t border-[#E2DBD0] dark:border-[#262626] pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#B38E22] dark:text-[#D4AF37] mb-3">
                Extras y Diseños (opcional)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {extrasList.map((extra) => {
                  const isChecked = selectedExtraIds.includes(extra.id);
                  return (
                    <div
                      key={extra.id}
                      onClick={() => toggleExtra(extra.id)}
                      className={`p-3 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition-all ${
                        isChecked
                          ? "bg-[#FFFDF9] dark:bg-[#252119] border-2 border-[#D4AF37] font-medium text-[#171717] dark:text-[#FFFFFF]"
                          : "bg-[#FAF8F5] dark:bg-[#1A1A1A] border border-[#E2DBD0] dark:border-[#2A2A2A] text-[#555555] dark:text-[#A3A3A3] hover:border-[#D4AF37]/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border ${
                            isChecked
                              ? "bg-[#D4AF37] border-[#D4AF37] text-[#121212]"
                              : "border-[#CCCCCC] bg-[#FFFFFF] dark:border-[#444444] dark:bg-[#222222]"
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 text-[#121212]" />}
                        </div>
                        <span className={isChecked ? "text-[#171717] dark:text-white font-semibold" : "text-[#555555] dark:text-[#D1D1D1]"}>{extra.nombre}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-semibold text-[#B38E22] dark:text-[#D4AF37]">
                          +{formatPrice(extra.precio)}
                        </span>
                        <span className="text-[10px] text-[#737373] dark:text-[#888888] block">
                          +{extra.duracion}m
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* PASO 2: CALENDARIO Y HORARIOS DISPONIBLES */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#FFFFFF] dark:bg-[#161616]/85 border border-[#E2DBD0] dark:border-[#2D2D2D] backdrop-blur-md shadow-xl text-[#171717] dark:text-white transition-colors duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-full bg-[#D4AF37] text-[#121212] text-xs font-bold flex items-center justify-center">
                2
              </div>
              <div>
                <h2 className="font-cinzel text-lg sm:text-xl font-bold text-[#171717] dark:text-[#FFFFFF]">
                  Selecciona Fecha y Horario Libre
                </h2>
                <p className="text-xs text-[#737373] dark:text-[#A3A3A3] font-light">
                  El motor calcula los horarios que garantizan {totalDuration} min de atención continua.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Selector de calendario */}
              <div className="flex justify-center p-3 rounded-2xl bg-[#FAF8F5] dark:bg-[#121212] border border-[#E2DBD0] dark:border-[#262626]">
                <CalendarUI
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => isBefore(date, startOfToday())}
                  locale={es}
                  className="rounded-md text-[#171717] dark:text-white"
                />
              </div>

              {/* Lista de horarios generados */}
              <div>
                <div className="text-xs font-bold text-[#171717] dark:text-[#FFFFFF] mb-2 flex items-center justify-between">
                  <span>
                    {selectedDate ? (
                      format(selectedDate, "dd/MM/yyyy", { locale: es })
                    ) : (
                      "Selecciona un día"
                    )}
                  </span>
                  <span className="text-[11px] font-normal text-[#737373] dark:text-[#A3A3A3]">
                    Duración: {formatDuration(totalDuration)}
                  </span>
                </div>

                {loadingSlots ? (
                  <div className="p-8 text-center text-xs text-[#737373] dark:text-[#A3A3A3]">
                    <div className="w-6 h-6 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    Calculando horarios sin superposiciones...
                  </div>
                ) : isClosedDay ? (
                  <div className="p-6 rounded-2xl bg-[#FAF8F5] dark:bg-[#1A1A1A] text-center border border-[#E2DBD0] dark:border-[#333333]">
                    <AlertCircle className="w-6 h-6 text-[#B38E22] dark:text-[#D4AF37] mx-auto mb-2" />
                    <p className="text-xs font-medium text-[#171717] dark:text-[#FFFFFF]">
                      El estudio no atiende en este día
                    </p>
                    <p className="text-[11px] text-[#737373] dark:text-[#A3A3A3] mt-1">
                      El estudio se encuentra cerrado en esta fecha. Por favor selecciona otro día en el calendario.
                    </p>
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-[#FAF8F5] dark:bg-[#1A1A1A] text-center border border-[#E2DBD0] dark:border-[#333333]">
                    <Clock className="w-6 h-6 text-[#737373] dark:text-[#A3A3A3] mx-auto mb-2" />
                    <p className="text-xs font-medium text-[#171717] dark:text-[#FFFFFF]">
                      Agenda completa para este día
                    </p>
                    <p className="text-[11px] text-[#737373] dark:text-[#A3A3A3] mt-1">
                      No quedan bloques libres de {totalDuration} minutos. Prueba seleccionando otra fecha.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                    {availableSlots.map((slot) => {
                      const isSelected = selectedSlot?.time === slot.time;
                      return (
                        <button
                          key={slot.time}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={`py-2.5 px-3 rounded-xl border text-xs text-center transition-all cursor-pointer ${
                            isSelected
                              ? "bg-[#D4AF37] text-[#121212] border-[#D4AF37] shadow-md font-bold scale-102"
                              : "bg-[#FAF8F5] dark:bg-[#1A1A1A] text-[#171717] dark:text-[#E5E5E5] border border-[#E2DBD0] dark:border-[#2A2A2A] hover:border-[#D4AF37] hover:bg-[#F0ECE4] dark:hover:bg-[#222222]"
                          }`}
                        >
                          <div className="text-sm font-bold font-cinzel">
                            {slot.time}
                          </div>
                          <div className={`text-[10px] ${isSelected ? "text-[#121212]/80" : "text-[#B38E22] dark:text-[#D4AF37]"}`}>
                            hasta {slot.endTime}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PASO 3: TUS DATOS DE CONTACTO */}
          <div className="p-6 sm:p-8 rounded-3xl bg-[#FFFFFF] dark:bg-[#161616]/85 border border-[#E2DBD0] dark:border-[#2D2D2D] backdrop-blur-md shadow-xl text-[#171717] dark:text-white transition-colors duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 rounded-full bg-[#D4AF37] text-[#121212] text-xs font-bold flex items-center justify-center">
                3
              </div>
              <div>
                <h2 className="font-cinzel text-lg sm:text-xl font-bold text-[#171717] dark:text-[#FFFFFF]">
                  Completa tus Datos
                </h2>
                <p className="text-xs text-[#737373] dark:text-[#A3A3A3] font-light">
                  Te enviaremos los recordatorios y la confirmación a tu WhatsApp.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-[#B38E22] dark:text-[#D4AF37]" />
                  <span>Nombre y Apellido *</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Sofia Martínez"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-[#FAF8F5] dark:bg-[#121212] text-[#171717] dark:text-white placeholder:text-[#888888] dark:placeholder:text-[#666666]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-[#B38E22] dark:text-[#D4AF37]" />
                  <span>Teléfono / WhatsApp *</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="Ej: 3516002716"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-[#FAF8F5] dark:bg-[#121212] text-[#171717] dark:text-white placeholder:text-[#888888] dark:placeholder:text-[#666666]"
                />
              </div>
            </div>

            {/* Selector de Ubicación */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-[#171717] dark:text-[#E0E0E0] mb-2 flex items-center gap-1">
                <span>¿Dónde te vas a atender? *</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {settings?.enableInShopBooking !== false && (
                <button
                  type="button"
                  onClick={() => setLocationType("LOCAL")}
                  className={`py-2.5 px-4 rounded-xl border text-xs font-bold transition-all ${
                    locationType === "LOCAL"
                      ? "bg-[#D4AF37] text-[#121212] border-[#D4AF37]"
                      : "bg-[#FAF8F5] dark:bg-[#121212] text-[#737373] dark:text-[#A3A3A3] border-[#E2DBD0] dark:border-[#333333] hover:border-[#D4AF37]"
                  }`}
                >
                  En el Local
                </button>
                )}
                {settings?.enableAtHomeBooking !== false && (
                <button
                  type="button"
                  onClick={() => setLocationType("DOMICILIO")}
                  className={`py-2.5 px-4 rounded-xl border text-xs font-bold transition-all ${
                    locationType === "DOMICILIO"
                      ? "bg-[#D4AF37] text-[#121212] border-[#D4AF37]"
                      : "bg-[#FAF8F5] dark:bg-[#121212] text-[#737373] dark:text-[#A3A3A3] border-[#E2DBD0] dark:border-[#333333] hover:border-[#D4AF37]"
                  }`}
                >
                  A Domicilio
                </button>
                )}
              </div>
            </div>

            {locationType === "DOMICILIO" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 p-4 rounded-2xl bg-[#FDFBF7] dark:bg-[#1A1A1A] border border-[#E2DBD0] dark:border-[#2D2D2D]">
                <div className="sm:col-span-2">
                  <h4 className="text-xs font-bold text-[#B38E22] dark:text-[#D4AF37] mb-3 uppercase tracking-wide">Datos del Domicilio</h4>
                </div>
                
                <div>
                  <label className="block text-[11px] font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5">Calle *</label>
                  <input
                    type="text"
                    required={locationType === "DOMICILIO"}
                    placeholder="Ej: Av. San Martín"
                    value={addressStreet}
                    onChange={(e) => setAddressStreet(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-white dark:bg-[#121212] text-[#171717] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5">Altura / Número *</label>
                  <input
                    type="text"
                    required={locationType === "DOMICILIO"}
                    placeholder="Ej: 1530"
                    value={addressNumber}
                    onChange={(e) => setAddressNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-white dark:bg-[#121212] text-[#171717] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5">Barrio *</label>
                  <input
                    type="text"
                    required={locationType === "DOMICILIO"}
                    placeholder="Ej: Centro"
                    value={addressNeighborhood}
                    onChange={(e) => setAddressNeighborhood(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-white dark:bg-[#121212] text-[#171717] dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5">Piso, Depto, Timbre (Opcional)</label>
                  <input
                    type="text"
                    placeholder="Ej: 4to B, Casa con rejas"
                    value={addressInfo}
                    onChange={(e) => setAddressInfo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-white dark:bg-[#121212] text-[#171717] dark:text-white"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#171717] dark:text-[#E0E0E0] mb-1.5 flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-[#B38E22] dark:text-[#D4AF37]" />
                <span>Observaciones o detalles de diseño (opcional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="Ej: Tengo una uña partida en la mano derecha, me gustaría un tono vía láctea con francesita."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-[#E2DBD0] dark:border-[#333333] text-xs focus:outline-none focus:border-[#D4AF37] bg-[#FAF8F5] dark:bg-[#121212] text-[#171717] dark:text-white placeholder:text-[#888888] dark:placeholder:text-[#666666]"
              />
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA: RESUMEN, POLÍTICAS Y CONFIRMAR */}
        <div className="lg:col-span-1 sticky top-20 space-y-4">
          <div className="p-6 rounded-3xl bg-[#FFFFFF] dark:bg-[#141414]/95 text-[#171717] dark:text-[#FFFFFF] border-2 border-[#D4AF37] shadow-2xl backdrop-blur-md transition-colors duration-200">
            <div className="text-[10px] uppercase font-bold tracking-widest text-[#B38E22] dark:text-[#D4AF37] mb-2">
              Resumen de Reserva
            </div>
            <h3 className="font-cinzel text-xl font-bold text-[#171717] dark:text-[#FFFFFF] mb-4">
              ÁGAPE STUDIO
            </h3>

            {/* Servicio principal */}
            <div className="space-y-2 text-xs border-b border-[#E2DBD0] dark:border-[#2C2C2C] pb-4 mb-4">
              <div className="flex justify-between font-semibold">
                <span className="text-[#171717] dark:text-white">{selectedService.nombre}</span>
                <span className="text-[#B38E22] dark:text-[#D4AF37]">{formatPrice(selectedService.precio)}</span>
              </div>
              <div className="text-[11px] text-[#737373] dark:text-[#888888]">
                Tiempo base: {selectedService.duracion} min
              </div>

              {selectedExtras.map((extra) => (
                <div key={extra.id} className="flex justify-between text-[#B38E22] dark:text-[#D4AF37] text-xs pt-1">
                  <span>+ {extra.nombre}</span>
                  <span>+{formatPrice(extra.precio)}</span>
                </div>
              ))}
            </div>

            {/* Fecha y horario seleccionado */}
            <div className="space-y-2 text-xs border-b border-[#E2DBD0] dark:border-[#2C2C2C] pb-4 mb-4">
              <div className="flex items-center gap-2 text-[#737373] dark:text-[#A3A3A3]">
                <CalendarIcon className="w-4 h-4 text-[#B38E22] dark:text-[#D4AF37]" />
                <span className="text-[#171717] dark:text-white font-medium">
                  {selectedDate
                    ? format(selectedDate, "dd/MM/yyyy", { locale: es })
                    : "Fecha no seleccionada"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[#737373] dark:text-[#A3A3A3]">
                <Clock className="w-4 h-4 text-[#B38E22] dark:text-[#D4AF37]" />
                <span className="text-[#171717] dark:text-white font-medium">
                  {selectedSlot
                    ? `${selectedSlot.time} hs a ${selectedSlot.endTime} hs (${totalDuration} min)`
                    : "Horario no seleccionado"}
                </span>
              </div>
            </div>

            {/* Totales */}
            <div className="flex items-center justify-between mb-5">
              <span className="font-cinzel text-sm text-[#737373] dark:text-[#A3A3A3]">Total a Abonar:</span>
              <span className="font-cinzel text-2xl font-bold text-[#B38E22] dark:text-[#D4AF37]">
                {formatPrice(totalPrice)}
              </span>
            </div>

            {/* Políticas de seña y cancelación */}
            <div className="p-3.5 rounded-2xl bg-[#FAF8F5] dark:bg-[#1A1A1A] border border-[#E2DBD0] dark:border-[#2E2E2E] text-[11px] text-[#555555] dark:text-[#A3A3A3] space-y-1.5 mb-5 leading-snug">
              <div className="flex items-start gap-1.5 text-[#171717] dark:text-[#FFFFFF] font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-[#B38E22] dark:text-[#D4AF37] shrink-0 mt-0.5" />
                <span>Políticas de Turno & Asistencia</span>
              </div>
              <p>• Tolerancia máxima de espera: 15 minutos.</p>
              <p>• Cancelaciones o reprogramaciones con al menos 24 hs de anticipación.</p>
              <p>• Asistir con las uñas limpias sin aceites ni cremas en las manos.</p>
            </div>

            {/* Error si existe */}
            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-500 text-red-800 dark:text-red-200 text-xs mb-4 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Botón de confirmar */}
            <button
              type="submit"
              disabled={submitting || !selectedDate || !selectedSlot}
              className="w-full py-4 px-4 rounded-full bg-[#D4AF37] text-[#121212] font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#171717] hover:text-[#FFFFFF] dark:hover:bg-[#FFFFFF] dark:hover:text-[#121212] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg cursor-pointer group"
            >
              {submitting ? (
                <span>Confirmando tu turno...</span>
              ) : (
                <>
                  <span>Confirmar mi Turno</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function BookPage() {
  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <Navbar />
      <Suspense fallback={<div className="p-12 text-center text-sm text-[#A3A3A3]">Cargando reserva de ÁGAPE STUDIO...</div>}>
        <BookContent />
      </Suspense>
      <Footer />
    </div>
  );
}
