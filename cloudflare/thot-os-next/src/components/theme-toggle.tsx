"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const themeStorageKey = "thot-os-theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    let storedTheme: string | null = null;
    try {
      storedTheme = window.localStorage.getItem(themeStorageKey);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    const nextIsDark = storedTheme !== "light";
    document.documentElement.classList.toggle("dark", nextIsDark);
    requestAnimationFrame(() => setIsDark(nextIsDark));
  }, []);

  function toggleTheme() {
    const nextIsDark = !isDark;
    setIsDark(nextIsDark);
    document.documentElement.classList.toggle("dark", nextIsDark);
    try {
      window.localStorage.setItem(themeStorageKey, nextIsDark ? "dark" : "light");
    } catch {
      // The selected theme still applies for the current page session.
    }
  }

  const label = isDark ? "Use light theme" : "Use dark theme";
  return (
    <Button aria-label={label} onClick={toggleTheme} size="icon-sm" title={label} type="button" variant="outline">
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
