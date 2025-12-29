
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    DATABASE_URL: process.env.DATABASE_URL ? '✓ Set (length: ' + process.env.DATABASE_URL.length + ')' : '✗ Not set',
    AUTH_SECRET: process.env.AUTH_SECRET ? '✓ Set (length: ' + process.env.AUTH_SECRET.length + ')' : '✗ Not set',
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? '✓ Set (length: ' + process.env.NEXTAUTH_SECRET.length + ')' : '✗ Not set',
    NEXTAUTH_URL: process.env.NEXTAUTH_URL ? '✓ Set: ' + process.env.NEXTAUTH_URL : '✗ Not set',
    AUTH_URL: process.env.AUTH_URL ? '✓ Set: ' + process.env.AUTH_URL : '✗ Not set',
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL ? '✓ Running on Vercel' : '✗ Not on Vercel',
    VERCEL_URL: process.env.VERCEL_URL || 'Not set',
  });
}
