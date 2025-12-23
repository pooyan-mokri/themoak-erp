const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, 'node_modules/.prisma/client/index.d.ts');

try {
  if (fs.existsSync(clientPath)) {
    const content = fs.readFileSync(clientPath, 'utf-8');
    const hasCurrency = content.includes('Currency');
    const hasExportCurrency = content.includes('export const Currency') || content.includes('export enum Currency') || content.includes('export type Currency');
    
    fs.writeFileSync('prisma_check_result.txt', `File exists.\nHas Currency: ${hasCurrency}\nHas Export Currency: ${hasExportCurrency}\nContent Preview:\n${content.substring(0, 500)}`);
  } else {
    fs.writeFileSync('prisma_check_result.txt', 'File does not exist.');
  }
} catch (error) {
  fs.writeFileSync('prisma_check_result.txt', `Error: ${error.message}`);
}
