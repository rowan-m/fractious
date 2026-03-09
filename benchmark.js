const map = new Map([[1, {x:1, y:1}], [2, {x:2, y:2}]]);

function benchArrayFrom() {
    let sum = 0;
    const start = performance.now();
    for (let i = 0; i < 10000000; i++) {
        const points = Array.from(map.values());
        const dx = points[0].x - points[1].x;
        sum += dx;
    }
    console.log(`Array.from: ${performance.now() - start} ms`);
    return sum;
}

function benchDestruct() {
    let sum = 0;
    const start = performance.now();
    for (let i = 0; i < 10000000; i++) {
        const [p1, p2] = map.values();
        const dx = p1.x - p2.x;
        sum += dx;
    }
    console.log(`Destructuring: ${performance.now() - start} ms`);
    return sum;
}

function benchIter() {
    let sum = 0;
    const start = performance.now();
    for (let i = 0; i < 10000000; i++) {
        const iter = map.values();
        const p1 = iter.next().value;
        const p2 = iter.next().value;
        const dx = p1.x - p2.x;
        sum += dx;
    }
    console.log(`Manual Iteration: ${performance.now() - start} ms`);
    return sum;
}

benchArrayFrom();
benchDestruct();
benchIter();
benchArrayFrom();
benchDestruct();
benchIter();
