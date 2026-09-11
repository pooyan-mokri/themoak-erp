// Server actions call these; outside a Next.js request they would throw.
export function revalidatePath(_path?: string, _type?: string) {}
export function revalidateTag(_tag?: string) {}
