
const fs = require('fs');
const content = `DATABASE_URL="postgresql://pooyanmokri@localhost:5432/themoak_erp?schema=public"
AUTH_SECRET="supersecretkey123"
NEXTAUTH_SECRET="supersecretkey123"
NEXTAUTH_URL="http://localhost:3000"
`;
try {
  fs.writeFileSync('.env', content);
  fs.writeFileSync('env_overwrite_success.txt', 'Success');
} catch (e) {
  fs.writeFileSync('env_overwrite_error.txt', `Error: ${e.message}`);
}
