const fs = require('fs').promises;
const path = require('path');

function getClassStateFromSource(source) {
    const src = (source || '').toLowerCase();
    const isUnclass = src.includes('unclass');
    const isClassified = src.includes('class') && !isUnclass;
    if (isUnclass) return 'unclassified';
    if (isClassified) return 'classified';
    return null;
}

async function loadAllPeople() {
    const dir = path.join(__dirname, 'data', 'people');
    const files = (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
    const data = {};
    const chunks = await Promise.all(files.map(async file => {
        const chunk = await fs.readFile(path.join(dir, file), 'utf8');
        return JSON.parse(chunk);
    }));
    for (let i = 0; i < chunks.length; i++) {
        Object.assign(data, chunks[i]);
    }
    return data;
}

async function main() {
    const data = await loadAllPeople();

    let mixedCount = 0;
    let classifiedToUnclassified = 0;
    let unclassifiedToClassified = 0;

    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const person = data[key];
        let hasClassified = false;
        let hasUnclassified = false;

        const timeline = person.Timeline;
        for (let j = 0; j < timeline.length; j++) {
            const snap = timeline[j];
            const currentState = getClassStateFromSource(snap.Source);
            if (currentState === 'unclassified') {
                hasUnclassified = true;
            } else if (currentState === 'classified') {
                hasClassified = true;
            }
            if (hasClassified && hasUnclassified) break;
        }

        if (hasClassified && hasUnclassified) {
            mixedCount++;
            const lastSnap = timeline[timeline.length - 1];
            const lastState = getClassStateFromSource(lastSnap.Source);

            if (lastState === 'unclassified') {
                classifiedToUnclassified++;
                // console.log(`Mixed: ${key} is currently Unclassified`);
            } else if (lastState === 'classified') {
                unclassifiedToClassified++;
                // console.log(`Mixed: ${key} is currently Classified`);
            }
        }
    }

    console.log(`Total mixed classification: ${mixedCount}`);
    console.log(`Currently Unclassified (was Classified): ${classifiedToUnclassified}`);
    console.log(`Currently Classified (was Unclassified): ${unclassifiedToClassified}`);
}

main().catch(console.error);
