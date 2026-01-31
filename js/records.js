document.addEventListener('DOMContentLoaded', () => {
    const listContainer = document.getElementById('records-list');
    const searchInput = document.getElementById('record-search');
    const clearBtn = document.getElementById('clear-search');
    const filterChips = document.querySelectorAll('.chip');

    let allRecords = [];
    let currentFilter = 'all';

    // 1. Fetch Data
    fetch('records.json')
        .then(response => {
            if (!response.ok) throw new Error("Failed to load records");
            return response.json();
        })
        .then(records => {
            allRecords = records;
            // Sort by date descending (newest first)
            allRecords.sort((a, b) => new Date(b.date) - new Date(a.date));
            renderRecords();
        })
        .catch(err => {
            console.error(err);
            listContainer.innerHTML = `<div class="error">Error loading records: ${err.message}</div>`;
        });

    // 2. Event Listeners
    searchInput.addEventListener('input', (e) => {
        toggleClearBtn(e.target.value);
        renderRecords();
    });

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        toggleClearBtn('');
        renderRecords();
        searchInput.focus();
    });

    filterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.getAttribute('data-filter');
            renderRecords();
        });
    });

    function toggleClearBtn(val) {
        if (val.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
    }

    // 3. Render Logic
    function renderRecords() {
        listContainer.innerHTML = '';
        const searchTerm = searchInput.value.toLowerCase();

        // Filter first
        const filtered = allRecords.filter(record => {
            const matchesSearch = (
                (record.title && record.title.toLowerCase().includes(searchTerm)) ||
                (record.year && record.year.toString().includes(searchTerm)) ||
                (record.type && record.type.toLowerCase().includes(searchTerm))
            );
            const matchesType = currentFilter === 'all' || record.type === currentFilter;
            return matchesSearch && matchesType;
        });

        if (filtered.length === 0) {
            listContainer.innerHTML = `<div class="loader-sentinel">No matching records found.</div>`;
            return;
        }

        // Group by Year
        const recordsByYear = {};
        filtered.forEach(record => {
            if (!recordsByYear[record.year]) {
                recordsByYear[record.year] = [];
            }
            recordsByYear[record.year].push(record);
        });

        // Get Years sorted descending
        const sortedYears = Object.keys(recordsByYear).sort((a, b) => b - a);

        sortedYears.forEach(year => {
            // Create Header
            const yearHeader = document.createElement('h2');
            yearHeader.className = 'year-separator';
            yearHeader.textContent = year;
            listContainer.appendChild(yearHeader);

            // Create Grid for this specific year
            const grid = document.createElement('div');
            grid.className = 'records-grid';
            
            recordsByYear[year].forEach(record => {
                grid.appendChild(createRecordCard(record));
            });

            listContainer.appendChild(grid);
        });
    }

    function createRecordCard(record) {
        const card = document.createElement('article');
        card.className = 'record-card';

        const typeClass = record.type.toLowerCase() === 'classified' ? 'type-classified' : 'type-unclassified';
        const title = record.title || record.filename;

        card.innerHTML = `
            <div class="meta-row">
                <span>${record.date}</span>
                <span>${record.quarter}</span>
            </div>
            <h3 class="record-title">${title}</h3>
            <div class="record-meta">
                <span class="tag ${typeClass}">${record.type}</span>
                <span class="tag">Auth: ${record.author}</span>
            </div>
            <a href="reports/${record.filename}"
               target="_blank"
               rel="noopener noreferrer"
               class="download-btn"
               aria-label="Download ${title}">
                Download PDF ⬇
            </a>
        `;
        return card;
    }
});