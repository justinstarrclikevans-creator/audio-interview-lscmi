require('dotenv').config();
const { runDailyEvaluation } = require('./services/dropbox_evaluator');

(async () => {
    console.log("Running manual evaluation...");
    try {
        await runDailyEvaluation();
        console.log("Done");
    } catch(e) {
        console.error(e);
    }
})();
