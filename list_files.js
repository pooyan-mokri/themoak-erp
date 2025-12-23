
const fs = require('fs');
const path = require('path');

const logFile = fs.createWriteStream('dir_list.txt');
const originalLog = console.log;
console.log = function(...args) {
  logFile.write(args.join(' ') + '\n');
  originalLog.apply(console, args);
};

function listDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
        console.log('Directory does not exist:', dir);
        return;
    }
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        console.log('DIR:', fullPath);
        listDir(fullPath);
      } else {
        console.log('FILE:', fullPath, stat.size);
      }
    });
  } catch (e) {
    console.error('Error listing', dir, e.message);
    logFile.write('Error listing ' + dir + ': ' + e.message + '\n');
  }
}

console.log('Listing node_modules/.prisma');
listDir('node_modules/.prisma');
console.log('Listing node_modules/@prisma');
listDir('node_modules/@prisma');
