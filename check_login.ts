
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@example.com';
  const password = 'password';
  let log = '';

  log += `Checking login for ${email}...\n`;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    log += 'User not found\n';
    fs.writeFileSync('login_check_result.txt', log);
    return;
  }
  log += `User found: ${user.email}\n`;
  log += `Stored hash: ${user.password}\n`;

  const passwordsMatch = await bcrypt.compare(password, user.password);
  log += `Password match: ${passwordsMatch}\n`;
  
  fs.writeFileSync('login_check_result.txt', log);
}

main()
  .catch(e => fs.writeFileSync('login_check_result.txt', `Error: ${e.message}`))
  .finally(async () => {
    await prisma.$disconnect();
  });
