document.addEventListener('DOMContentLoaded', () => {
    const listContainer = document.getElementById('records-list');

    fetch('records.json')
        .then(response => {
            if (!response.ok) throw new Error("Failed to load records");
            return response.json();
        })
        .then(records => {
            renderRecords(records);
        })
        .catch(err => {
            console.error(err);
            listContainer.innerHTML = `<div class="error">Error loading records: ${err.message}</div>`;
        });

    function renderRecords(records) {
        listContainer.innerHTML = '';

        // Sort records by date descending
        records.sort((a, b) => new Date(b.date) - new Date(a.date));

        records.forEach(record => {
            const card = document.createElement('div');
            card.className = 'record-card';

            const typeClass = record.type.toLowerCase() === 'classified' ? 'type-classified' : 'type-unclassified';

            card.innerHTML = `
                <div class="meta-row">
                    <span>${record.date}</span>
                    <span>${record.year} ${record.quarter}</span>
                </div>
                <h3 class="record-title">${record.title || record.filename}</h3>
                <div class="record-meta">
                    <span class="tag ${typeClass}">${record.type}</span>
                    <span class="tag">Auth: ${record.author}</span>
                    <span class="tag">Sub: ${record.submitter}</span>
                </div>
                <a href="reports/${record.filename}" target="_blank" class="download-btn">
                    Download / View PDF
                </a>
            `;

            listContainer.appendChild(card);
        });
    }
});
