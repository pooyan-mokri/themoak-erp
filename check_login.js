
const fs = require('fs');
try { fs.writeFileSync('debug_start.txt', 'Started'); } catch (e) {}

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@example.com';
  const password = 'password';
  let log = '';

  log += `Checking login for ${email}...\n`;

  try {
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
  } catch (e) {
    log += `Error: ${e.message}\n`;
  }
  
  fs.writeFileSync('login_check_result.txt', log);
}

main()
  .catch(e => fs.writeFileSync('login_check_result.txt', `Fatal Error: ${e.message}`))
  .finally(async () => {
    await prisma.$disconnect();
  });
