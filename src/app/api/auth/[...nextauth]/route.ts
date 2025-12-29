import { handlers } from "@/auth";

console.log('[AUTH DEBUG] API route initialized');
console.log('[AUTH DEBUG] Handlers:', !!handlers);

export const { GET, POST } = handlers;

