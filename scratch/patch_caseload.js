const fs = require('fs');
let js = fs.readFileSync('public/app.js', 'utf8');

// ===========================================
// 1. Drug Screen badges: Remove onclick & cursor from both YES and NO states
// ===========================================

// DT YES badge - remove cursor:pointer and onclick
js = js.replace(
    /padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10\.5px; cursor: pointer; box-shadow: 0 1px 2px rgba\(0,0,0,0\.04\);" onclick="openLoadProgramFormsModal\('drugtest', \$\{p\.id\}\)" title="Click to view\/add drug screen"/g,
    'padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10.5px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);" title="Drug screen status"'
);

// DT NO badge - remove cursor:pointer and onclick
js = js.replace(
    /padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10\.5px; cursor: pointer;" onclick="openLoadProgramFormsModal\('drugtest', \$\{p\.id\}\)" title="Click to log drug screen"/g,
    'padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10.5px;" title="No drug screen this week"'
);

// Remove the "+ Screen" clickable text from DT NO badge
js = js.replace(
    /<div style="font-size: 9px; font-weight: 600; margin-top: 1px; color: #ef4444;">\\+ Screen<\/div>/g,
    ''
);

// ===========================================
// 2. CM badges: Remove onclick & cursor from both YES and NO states
// ===========================================

// CM YES badge - remove cursor:pointer and onclick
js = js.replace(
    /padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10\.5px; cursor: pointer; box-shadow: 0 1px 2px rgba\(0,0,0,0\.04\);" onclick="openLoadProgramFormsModal\('casenotes', \$\{p\.id\}\)" title="Click to view\/add 1-on-1 session"/g,
    'padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10.5px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);" title="Case management status"'
);

// CM NO badge - remove cursor:pointer and onclick
js = js.replace(
    /padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10\.5px; cursor: pointer;" onclick="openLoadProgramFormsModal\('casenotes', \$\{p\.id\}\)" title="Click to log 1-on-1 session"/g,
    'padding: 4px 6px; border-radius: 6px; text-align: center; font-weight: 800; font-size: 10.5px;" title="No case management this week"'
);

// Remove the "+ Log CM" clickable text from CM NO badge
js = js.replace(
    /<div style="font-size: 9px; font-weight: 600; margin-top: 1px; color: #ea580c;">\\+ Log CM<\/div>/g,
    ''
);

fs.writeFileSync('public/app.js', js);
console.log('✅ Patched DT and CM badges to read-only');
