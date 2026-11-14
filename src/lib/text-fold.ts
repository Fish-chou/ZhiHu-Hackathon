/** Case- and diacritic-insensitive form, so "Hoang Sa" matches "Hoàng Sa". */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();
}
