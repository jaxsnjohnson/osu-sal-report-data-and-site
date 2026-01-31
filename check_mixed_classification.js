const fs = require('fs').promises;

async function main() {
    const data = JSON.parse(await fs.readFile('data.json', 'utf8'));

    let mixedCount = 0;
    let classifiedToUnclassified = 0;
    let unclassifiedToClassified = 0;

    Object.keys(data).forEach(key => {
        const person = data[key];
        let hasClassified = false;
        let hasUnclassified = false;

        person.Timeline.forEach(snap => {
            const src = snap.Source.toLowerCase();
            if (src.includes('unclass')) {
                hasUnclassified = true;
            } else if (src.includes('class')) {
                hasClassified = true;
            }
        });

        if (hasClassified && hasUnclassified) {
            mixedCount++;
            const lastSnap = person.Timeline[person.Timeline.length - 1];
            const lastSrc = lastSnap.Source.toLowerCase();

            if (lastSrc.includes('unclass')) {
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
