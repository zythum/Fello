import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSessionTime(updatedAtSeconds: number): string {
  const date = new Date(updatedAtSeconds * 1000);
  const now = new Date();

  const isSameYear = date.getFullYear() === now.getFullYear();
  const isSameMonth = isSameYear && date.getMonth() === now.getMonth();
  const isSameDay = isSameMonth && date.getDate() === now.getDate();

  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;

  if (isSameDay) {
    return timeStr;
  }

  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");

  if (isSameYear) {
    return `${month}-${day} ${timeStr}`;
  }

  const year = date.getFullYear();
  return `${year}-${month}-${day} ${timeStr}`;
}
