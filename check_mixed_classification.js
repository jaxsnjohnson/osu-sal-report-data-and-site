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

    const chunks = await Promise.all(
        files.map(async file => JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')))
    );

    for (const chunk of chunks) {
        Object.assign(data, chunk);
    }
    return data;
}

async function main() {
    const data = await loadAllPeople();

    let mixedCount = 0;
    let classifiedToUnclassified = 0;
    let unclassifiedToClassified = 0;

    Object.keys(data).forEach(key => {
        const person = data[key];
        let hasClassified = false;
        let hasUnclassified = false;

        for (const snap of person.Timeline) {
            const state = getClassStateFromSource(snap.Source);
            if (state === 'unclassified') {
                hasUnclassified = true;
            } else if (state === 'classified') {
                hasClassified = true;
            }
            if (hasClassified && hasUnclassified) break;
        }

        if (hasClassified && hasUnclassified) {
            mixedCount++;
            const lastSnap = person.Timeline[person.Timeline.length - 1];
            const lastState = getClassStateFromSource(lastSnap.Source);

            if (lastState === 'unclassified') {
                classifiedToUnclassified++;
                // console.log(`Mixed: ${key} is currently Unclassified`);
            } else {
                unclassifiedToClassified++;
                // console.log(`Mixed: ${key} is currently Classified`);
            }
        }
    });

    console.log(`Total mixed classification: ${mixedCount}`);
    console.log(`Currently Unclassified (was Classified): ${classifiedToUnclassified}`);
    console.log(`Currently Classified (was Unclassified): ${unclassifiedToClassified}`);
}

main().catch(console.error);
