const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

js = js.replace(
    /const evals = await evalsRes\.json\(\);\s*const stats = await statsRes\.json\(\);/,
    `const evals = await safeApiResponse(evalsRes);
        const stats = await safeApiResponse(statsRes);
        
        if (!Array.isArray(evals)) throw new Error(evals.error || 'Evaluations must be an array');
        if (!Array.isArray(stats)) throw new Error(stats.error || 'Stats must be an array');`
);

fs.writeFileSync('public/app.js', js);
console.log('Patched app.js');
