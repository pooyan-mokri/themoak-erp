import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';

export async function GET() {
  return new NextResponse(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Setup Admin</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
        button { padding: 10px 20px; font-size: 16px; cursor: pointer; background: #0070f3; color: white; border: none; border-radius: 5px; }
        button:hover { background: #0051cc; }
        .result { margin-top: 20px; padding: 15px; border-radius: 5px; }
        .success { background: #d4edda; color: #155724; }
        .error { background: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <h1>Setup Admin User</h1>
      <p>Click the button below to create the initial admin user.</p>
      <button onclick="createAdmin()">Create Admin User</button>
      <div id="result"></div>

      <script>
        async function createAdmin() {
          const btn = event.target;
          btn.disabled = true;
          btn.textContent = 'Creating...';

          try {
            const response = await fetch('/api/setup-admin', { method: 'POST' });
            const data = await response.json();

            const resultDiv = document.getElementById('result');
            if (data.success) {
              resultDiv.className = 'result success';
              resultDiv.innerHTML = \`
                <h3>✓ Success!</h3>
                <p>\${data.message}</p>
                <p><strong>Email:</strong> \${data.credentials.email}</p>
                <p><strong>Password:</strong> \${data.credentials.password}</p>
                <p style="color: #856404; background: #fff3cd; padding: 10px; border-radius: 5px; margin-top: 10px;">
                  ⚠️ \${data.credentials.warning}
                </p>
                <a href="/login" style="display: inline-block; margin-top: 15px; padding: 10px 20px; background: #0070f3; color: white; text-decoration: none; border-radius: 5px;">
                  Go to Login
                </a>
              \`;
            } else {
              resultDiv.className = 'result error';
              resultDiv.innerHTML = \`<h3>✗ Error</h3><p>\${data.message}</p>\`;
              btn.disabled = false;
              btn.textContent = 'Create Admin User';
            }
          } catch (error) {
            const resultDiv = document.getElementById('result');
            resultDiv.className = 'result error';
            resultDiv.innerHTML = \`<h3>✗ Error</h3><p>Failed to create admin user: \${error.message}</p>\`;
            btn.disabled = false;
            btn.textContent = 'Create Admin User';
          }
        }
      </script>
    </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' },
  });
}

export async function POST() {
  try {
    // Check if any admin user exists
    const existingAdmin = await prisma.user.findFirst({
      where: { role: Role.ADMIN }
    });

    if (existingAdmin) {
      return NextResponse.json({
        success: false,
        message: 'Admin user already exists',
      }, { status: 400 });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash('admin123456', 10);

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        email: 'admin@themoak.com',
        name: 'Admin',
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Admin user created successfully!',
      credentials: {
        email: 'admin@themoak.com',
        password: 'admin123456',
        warning: '⚠️ IMPORTANT: Change this password after first login!'
      }
    });
  } catch (error) {
    console.error('Error creating admin user:', error);
    return NextResponse.json({
      success: false,
      message: 'Error creating admin user',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
