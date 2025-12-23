const fs = require('fs');
try {
  fs.writeFileSync('debug_node.txt', 'Node is running and can write files.');
  console.log('File written');
} catch (e) {
  console.error(e);
}
