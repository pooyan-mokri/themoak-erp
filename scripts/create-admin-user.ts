import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    // Check if admin already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'admin@themoak.com' }
    });

    if (existingAdmin) {
      console.log('✓ Admin user already exists');
      console.log('Email: admin@themoak.com');
      return;
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

    console.log('✓ Admin user created successfully!');
    console.log('');
    console.log('Login credentials:');
    console.log('==================');
    console.log('Email: admin@themoak.com');
    console.log('Password: admin123456');
    console.log('');
    console.log('⚠️  IMPORTANT: Change this password after first login!');
  } catch (error) {
    console.error('Error creating admin user:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();
