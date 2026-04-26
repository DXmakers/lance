
import fs from 'fs';

const content = fs.readFileSync('app/jobs/page.tsx', 'utf8');
let stack = [];
let pairs = { '{': '}', '(': ')', '[': ']' };
let lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    for (let j = 0; j < line.length; j++) {
        let char = line[j];
        if (pairs[char]) {
            stack.push({ char, line: i + 1, col: j + 1 });
        } else if (Object.values(pairs).includes(char)) {
            if (stack.length === 0) {
                console.log(`Unmatched closing ${char} at line ${i + 1}, col ${j + 1}`);
            } else {
                let last = stack.pop();
                if (pairs[last.char] !== char) {
                    console.log(`Mismatched ${char} at line ${i + 1}, col ${j + 1}. Expected ${pairs[last.char]} from line ${last.line}, col ${last.col}`);
                }
            }
        }
    }
}

if (stack.length > 0) {
    stack.forEach(s => console.log(`Unclosed ${s.char} from line ${s.line}, col ${s.col}`));
} else {
    console.log("Brackets are balanced!");
}
