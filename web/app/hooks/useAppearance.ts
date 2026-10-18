"use client";

import { useCallback, useEffect, useState } from "react";
import { isLowSpecDevice } from "../lib/performance-policy";

export type Language = "ko" | "en";
export type Theme = "light" | "dim" | "dark" | "high-contrast";
export type FontScale = "normal" | "large" | "xlarge";

function getInitialLanguage(): Language {
  const saved = localStorage.getItem("miroven-language");
  if (saved === "ko" || saved === "en") return saved;
  return (navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

function getInitialTheme(): Theme {
  const saved = localStorage.getItem("miroven-theme");
  if (
    saved === "light" ||
    saved === "dim" ||
    saved === "dark" ||
    saved === "high-contrast"
  ) {
    return saved;
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialFontScale(): FontScale {
  const saved = localStorage.getItem("miroven-font-scale");
  if (saved === "normal" || saved === "large" || saved === "xlarge") return saved;
  return "normal";
}

export function useAppearance() {
  const [language, setLanguage] = useState<Language>("ko");
  const [theme, setTheme] = useState<Theme>("light");
  const [fontScale, setFontScale] = useState<FontScale>("normal");
  const [lowSpecMode, setLowSpecMode] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initialLanguage = getInitialLanguage();
    const initialTheme = getInitialTheme();
    const initialFontScale = getInitialFontScale();
    const savedLowSpec = localStorage.getItem("miroven:low_spec_mode");

    queueMicrotask(() => {
      setLanguage(initialLanguage);
      setTheme(initialTheme);
      setFontScale(initialFontScale);
      setLowSpecMode(savedLowSpec === null ? isLowSpecDevice() : savedLowSpec === "true");
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.fontScale = fontScale;
    localStorage.setItem("miroven-language", language);
    localStorage.setItem("miroven-theme", theme);
    localStorage.setItem("miroven-font-scale", fontScale);
  }, [language, theme, fontScale]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (!localStorage.getItem("miroven-theme")) {
        setTheme(event.matches ? "dark" : "light");
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const setLowSpecModePreference = useCallback((enabled: boolean) => {
    setLowSpecMode(enabled);
    localStorage.setItem("miroven:low_spec_mode", String(enabled));
  }, []);

  return {
    fontScale,
    hydrated,
    language,
    lowSpecMode,
    setFontScale,
    setLanguage,
    setLowSpecMode: setLowSpecModePreference,
    setTheme,
    theme,
  };
}
