const RTM_EVENTS = require('@slack/client').RTM_EVENTS;

const META = {
    name: 'ping',
    short: 'pings the bot',
    examples: [
        '@bosta test',
    ],
};

function register(bot, rtm) {
    rtm.on(RTM_EVENTS.MESSAGE, (message) => {
        if (message.text === 'test') {
            rtm.sendMessage('icle', message.channel);
        }
    });
}

module.exports = {
    register,
    META,
};
