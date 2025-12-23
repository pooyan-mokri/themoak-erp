
const fs = require('fs');
try {
  let content = '';
  if (fs.existsSync('.env')) {
    content = fs.readFileSync('.env', 'utf-8');
  }
  
  if (!content.includes('AUTH_SECRET')) {
    fs.appendFileSync('.env', '\nAUTH_SECRET="supersecretkey123"');
  }
  if (!content.includes('NEXTAUTH_SECRET')) {
    fs.appendFileSync('.env', '\nNEXTAUTH_SECRET="supersecretkey123"');
  }
  if (!content.includes('NEXTAUTH_URL')) {
    fs.appendFileSync('.env', '\nNEXTAUTH_URL="http://localhost:3000"');
  }
  
  fs.writeFileSync('env_appended.txt', 'Success');
} catch (e) {
  fs.writeFileSync('env_appended.txt', `Error: ${e.message}`);
}
