const benchData = [];
for (let i = 0; i < 100000; i++) {
    const timeline = [];
    const size = 50;
    for (let j = 0; j < size; j++) {
        if (j < 10) timeline.push({ Source: 'Classified' });
        else timeline.push({ Source: 'Unclassified' });
    }
    benchData.push({ Timeline: timeline });
}

function testForEach() {
    let mixedCount = 0;
    for (let i = 0; i < benchData.length; i++) {
        let hasClassified = false;
        let hasUnclassified = false;
        benchData[i].Timeline.forEach(snap => {
            const src = snap.Source.toLowerCase();
            if (src.includes('unclass')) {
                hasUnclassified = true;
            } else if (src.includes('class')) {
                hasClassified = true;
            }
        });
        if (hasClassified && hasUnclassified) mixedCount++;
    }
}

function testForOf() {
    let mixedCount = 0;
    for (let i = 0; i < benchData.length; i++) {
        let hasClassified = false;
        let hasUnclassified = false;
        for (const snap of benchData[i].Timeline) {
            const src = snap.Source.toLowerCase();
            if (src.includes('unclass')) {
                hasUnclassified = true;
            } else if (src.includes('class')) {
                hasClassified = true;
            }
            if (hasUnclassified && hasClassified) break;
        }
        if (hasClassified && hasUnclassified) mixedCount++;
    }
}

console.time('forEach');
testForEach();
console.timeEnd('forEach');

console.time('forOf');
testForOf();
console.timeEnd('forOf');
