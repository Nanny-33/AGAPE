"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
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
import { getPublicServices, getPublicExtras } from "../actions";
import {
  Clock,
  Calendar,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ArrowRight,
  Check,
} from "lucide-react";

export default function ServiciosPage() {
  const [services, setServices] = useState<Service[]>(SERVICIOS_AGAPE);
  const [selectedService, setSelectedService] = useState<Service>(SERVICIOS_AGAPE[0]);
  const [selectedExtraIds, setSelectedExtraIds] = useState<string[]>([]);
  const [extras, setExtras] = useState<Extra[]>(EXTRAS_AGAPE);

  useEffect(() => {
    getPublicServices().then((list) => {
      if (list) {
        setServices(list as Service[]);
        if (list.length > 0) {
          setSelectedService(list[0] as Service);
        }
      }
    });
    getPublicExtras().then((list) => {
      if (list) {
        setExtras(list as Extra[]);
      }
    });
  }, []);

  // Extras actualmente seleccionados
  const selectedExtras = extras.filter((extra) =>
    selectedExtraIds.includes(extra.id)
  );

  const totalDuration = calculateTotalDuration(selectedService, selectedExtras);
  const totalPrice = calculateTotalPrice(selectedService, selectedExtras);

  const toggleExtra = (id: string) => {
    setSelectedExtraIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Construir enlace hacia la reserva con parámetros
  const bookingUrl = `/book?service=${selectedService.id}${
    selectedExtraIds.length > 0 ? `&extras=${selectedExtraIds.join(",")}` : ""
  }`;

  return (
    <div className="flex flex-col min-h-screen bg-transparent">
      <Navbar />

      {/* ENCABEZADO DE LA SECCIÓN */}
      <section className="bg-transparent pt-10 pb-12 border-b border-[#262626]/80">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#181818] border border-[#333333] shadow-md text-xs text-[#E0E0E0] mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[#D4AF37]" />
            <span className="tracking-wide uppercase font-semibold text-[10px]">
              Catálogo & Simulador de Citas
            </span>
          </div>
          <h1 className="font-cinzel text-3xl sm:text-5xl font-bold text-[#FFFFFF] mb-3">
            Nuestros Servicios & Extras
          </h1>
          <p className="text-sm text-[#A3A3A3] font-light max-w-xl mx-auto leading-relaxed">
            Explora cada técnica con total transparencia. Conoce exactamente qué incluye, los tiempos reales de trabajo y personaliza tus uñas agregando nail art o remoción.
          </p>
        </div>
      </section>

      {/* SELECTOR DE SERVICIOS (TABS / CARDS) */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-3">
          Paso 1 · Selecciona un Servicio Principal
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-10">
          {services.map((service) => {
            const isSelected = selectedService.id === service.id;
            return (
              <button
                key={service.id}
                onClick={() => setSelectedService(service)}
                className={`p-4 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between border backdrop-blur-md ${
                  isSelected
                    ? "bg-[#252119] text-[#FFFFFF] border-2 border-[#D4AF37] shadow-xl scale-[1.02]"
                    : "bg-[#161616]/85 text-[#E5E5E5] border border-[#2D2D2D] hover:border-[#D4AF37] hover:bg-[#1E1E1E]"
                }`}
              >
                <div>
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full inline-block mb-2 ${
                      isSelected ? "bg-[#D4AF37] text-[#121212]" : "bg-[#242424] text-[#D4AF37]"
                    }`}
                  >
                    {service.categoria}
                  </span>
                  <div
                    className={`font-cinzel text-base font-semibold leading-snug mb-2 ${
                      isSelected ? "text-[#FFFFFF]" : "text-[#E0E0E0]"
                    }`}
                  >
                    {service.nombre}
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#D4AF37]">{formatPrice(service.precio)}</span>
                  <span
                    className={`flex items-center gap-1 text-[11px] ${
                      isSelected ? "text-[#E5E5E5]" : "text-[#888888]"
                    }`}
                  >
                    <Clock className="w-3 h-3 text-[#D4AF37]" />
                    {formatDuration(service.duracion)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* DETALLE COMPLETO DEL SERVICIO SELECCIONADO */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start mb-12">
          {/* Ficha técnica y alcances */}
          <div className="lg:col-span-2 space-y-6">
            <div className="p-6 sm:p-8 rounded-3xl bg-[#161616]/85 border border-[#2D2D2D] backdrop-blur-md shadow-xl text-white">
              {/* Foto modelo del estilo de uñas terminado */}
              {selectedService.imagenUrl && (
                <div className="relative w-full h-60 sm:h-72 rounded-2xl overflow-hidden mb-6 bg-[#121212] border border-[#2A2A2A] shadow-md">
                  <img
                    src={selectedService.imagenUrl}
                    alt={selectedService.nombre}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-[#121212]/80 text-[#FFFFFF] backdrop-blur-md text-[11px] font-semibold border border-white/10">
                    {selectedService.categoria}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="font-cinzel text-2xl sm:text-3xl font-bold text-[#FFFFFF]">
                  {selectedService.nombre}
                </h2>
                <span className="text-xl font-bold text-[#D4AF37] font-cinzel">
                  {formatPrice(selectedService.precio)}
                </span>
              </div>

              <p className="text-sm text-[#A3A3A3] font-light leading-relaxed mb-6">
                {selectedService.descripcion}
              </p>

              {/* Métricas clave: Duración y Mantenimiento */}
              <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-[#1C1C1C] border border-[#2D2D2D] mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#262626] flex items-center justify-center text-[#D4AF37] shadow-sm">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-[#888888]">
                      Duración base
                    </div>
                    <div className="text-sm font-semibold text-[#FFFFFF]">
                      {formatDuration(selectedService.duracion)} ({selectedService.duracion} min)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#262626] flex items-center justify-center text-[#D4AF37] shadow-sm">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-[#888888]">
                      Mantenimiento sugerido
                    </div>
                    <div className="text-sm font-semibold text-[#FFFFFF]">
                      Cada {selectedService.mantenimientoDias} días
                    </div>
                  </div>
                </div>
              </div>

              {/* Qué incluye vs Qué NO incluye */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FFFFFF] mb-3">
                    <CheckCircle2 className="w-4 h-4 text-[#D4AF37]" />
                    <span>Qué incluye:</span>
                  </div>
                  <ul className="space-y-2">
                    {selectedService.queIncluye.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-[#CCCCCC]">
                        <Check className="w-3.5 h-3.5 text-[#D4AF37] shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#737373] mb-3">
                    <XCircle className="w-4 h-4 text-[#737373]" />
                    <span>Qué NO incluye:</span>
                  </div>
                  <ul className="space-y-2">
                    {selectedService.queNoIncluye.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-xs text-[#737373]">
                        <span className="text-[#666666] shrink-0 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Garantía e instrucciones */}
              <div className="mt-6 pt-6 border-t border-[#262626] space-y-3 text-xs">
                <div className="flex items-start gap-2 text-[#A3A3A3]">
                  <ShieldCheck className="w-4 h-4 text-[#D4AF37] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#FFFFFF]">Garantía:</strong> {selectedService.garantia}
                  </span>
                </div>
                <div className="flex items-start gap-2 text-[#A3A3A3]">
                  <HelpCircle className="w-4 h-4 text-[#8C7A5B] shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#FFFFFF]">Preparación para la cita:</strong>{" "}
                    {selectedService.instrucciones}
                  </span>
                </div>
              </div>
            </div>

            {/* SELECCIÓN DE EXTRAS (Paso 2) */}
            <div className="p-6 sm:p-8 rounded-3xl bg-[#161616]/85 border border-[#2D2D2D] backdrop-blur-md shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37]">
                    Paso 2 · Personaliza con Extras
                  </span>
                  <h3 className="font-cinzel text-xl font-bold text-[#FFFFFF] mt-1">
                    Diseños & Servicios Adicionales
                  </h3>
                </div>
              </div>
              <p className="text-xs text-[#A3A3A3] font-light mb-5">
                Los extras agregan tiempo y valor a tu sesión. Selecciónalos para que la agenda reserve el bloque horario exacto y evite demoras.
              </p>

              <div className="space-y-3">
                {extras.map((extra) => {
                  const isChecked = selectedExtraIds.includes(extra.id);
                  return (
                    <div
                      key={extra.id}
                      onClick={() => toggleExtra(extra.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                        isChecked
                          ? "bg-[#252119] border-2 border-[#D4AF37] shadow-md"
                          : "bg-[#1A1A1A] border border-[#2A2A2A] hover:border-[#D4AF37]/50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center border mt-0.5 shrink-0 transition-colors ${
                            isChecked
                              ? "bg-[#D4AF37] border-[#D4AF37] text-[#121212]"
                              : "border-[#444444] bg-[#222222]"
                          }`}
                        >
                          {isChecked && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-[#FFFFFF]">
                            {extra.nombre}
                          </div>
                          <div className="text-[11px] text-[#A3A3A3] font-light mt-0.5">
                            {extra.descripcion}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-[#D4AF37]">
                          +{formatPrice(extra.precio)}
                        </div>
                        <div className="text-[10px] text-[#888888] flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3 text-[#D4AF37]" />
                          +{extra.duracion} min
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SIMULADOR EN VIVO Y RESUMEN (Sticky Sidebar) */}
          <div className="lg:col-span-1 sticky top-20">
            <div className="p-6 rounded-3xl bg-[#141414]/95 text-[#FFFFFF] border-2 border-[#D4AF37] shadow-2xl backdrop-blur-md">
              <div className="text-[10px] uppercase font-bold tracking-widest text-[#D4AF37] mb-2">
                Resumen de tu Turno
              </div>
              <h3 className="font-cinzel text-xl font-bold text-[#FFFFFF] mb-4">
                Cálculo Estimado
              </h3>

              <div className="space-y-3 text-xs border-b border-[#2C2C2C] pb-4 mb-4">
                <div className="flex justify-between">
                  <span className="text-[#A3A3A3]">{selectedService.nombre}</span>
                  <span className="font-semibold text-white">{formatPrice(selectedService.precio)}</span>
                </div>
                <div className="flex justify-between text-[11px] text-[#888888]">
                  <span>Tiempo base:</span>
                  <span>{selectedService.duracion} min</span>
                </div>

                {selectedExtras.map((extra) => (
                  <div key={extra.id} className="flex justify-between text-[#D4AF37] pt-1">
                    <span>+ {extra.nombre}</span>
                    <span>+{formatPrice(extra.precio)}</span>
                  </div>
                ))}
              </div>

              {/* Totales calculados */}
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#A3A3A3] flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#D4AF37]" />
                    Duración Total:
                  </span>
                  <span className="font-bold text-[#FFFFFF] text-sm">
                    {formatDuration(totalDuration)} ({totalDuration} min)
                  </span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#2C2C2C]">
                  <span className="font-cinzel text-sm text-[#A3A3A3]">Total Estimado:</span>
                  <span className="font-cinzel text-2xl font-bold text-[#D4AF37]">
                    {formatPrice(totalPrice)}
                  </span>
                </div>
              </div>

              {/* Botón hacia reserva con los extras */}
              <Link
                href={bookingUrl}
                className="w-full py-3.5 px-4 rounded-full bg-[#D4AF37] text-[#121212] font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-[#FFFFFF] transition-all shadow-md group cursor-pointer"
              >
                <span>Agendar este Turno</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>

              <p className="text-[10px] text-[#737373] text-center mt-3 font-light">
                * En el siguiente paso podrás elegir el día y horario disponible.
              </p>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
