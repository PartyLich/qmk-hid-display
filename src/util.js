/**
 * Helper function to wait a few milliseconds using a promise
 * @param {number} ms
 * @return {Promise}
 */
function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

module.exports = {
    wait,
};
