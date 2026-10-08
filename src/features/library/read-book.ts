"use server";

import { getBook } from "./data";

// Read-only UI refresh through the existing verified owner/profile boundary.
export async function refreshLibraryBook(id: string) { return getBook(id); }
