const { exec } = require('child_process');
const fs = require('fs');

exec('npx tsc --noEmit', (error, stdout, stderr) => {
  const output = `Error: ${error ? error.message : 'None'}\nStdout: ${stdout}\nStderr: ${stderr}`;
  fs.writeFileSync('tsc_output.txt', output);
});
