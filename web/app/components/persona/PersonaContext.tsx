"use client";
import { createContext, useContext } from "react";
import type { Persona } from "../../lib/persona";

export const PersonaContext = createContext<Persona | null>(null);
export function usePersonaDisplay(language: "ko" | "en") {
  const persona = useContext(PersonaContext);
  return { name: persona?.name || (language === "ko" ? "나" : "Me"), handle: `@${persona?.handle || "private"}`, avatar: persona?.avatar, bio: persona?.bio || "" };
}
export function PersonaAvatar({ language, small = false }: { language: "ko" | "en"; small?: boolean }) {
  const persona = usePersonaDisplay(language);
  return <span className={`avatar${small ? " avatar-small" : ""}`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {persona.avatar ? <img src={persona.avatar} alt="" width={100} height={100} /> : persona.name.slice(0, 1)}
  </span>;
}
