
const fs = require('fs');
try {
  const content = fs.readFileSync('.env', 'utf-8');
  fs.writeFileSync('env_content.txt', content);
} catch (e) {
  fs.writeFileSync('env_content.txt', `Error: ${e.message}`);
}
