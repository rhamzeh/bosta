const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const spawn = require('child_process').spawn;
const url = require('url');

const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
const winston = require('winston');

const pre = require('../utils.js').pre;
const Plugin = require('../utils.js').Plugin;

const META = {
    name: 'snippets',
    short: 'runs user submitted code',
    examples: [
        'simply create a snippet and set the language that the bot understands, see next for additional.',
        '@bosta snippets support',
        '@bosta snippets config python',
    ],
};

function download(host, path, token) {
    const options = {
        host,
        path,
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };

    return new Promise((resolve, reject) => {
        https.get(options, (res) => {
            resolve(res);
        }).on('error', (error) => {
            reject(error);
        });
    });
}


function save(path, sourceStream) {
    return new Promise((resolve, reject) => {
        const targetStream = fs.createWriteStream(path);
        sourceStream.pipe(targetStream);

        targetStream.on('finish', () => {
            resolve(path);
        }).on('error', (error) => {
            reject(error);
        });
    });
}


function execute(name, config, sourceFolder) {
    let timeout = [config.timeout];

    if (typeof config.timeout === 'string') {
        timeout = config.timeout.split(' ');
    }

    const dockerArgs = [
        'run',
        '--rm',
        '--net', 'none',
        '-m', `${config.memory}M`,
        '-w', '/local',
        '-v', `${sourceFolder}:/local:ro`,
        config.image,
        'timeout',
        ...timeout,
        config.command,
        name,
    ];

    return new Promise((resolve) => {
        const docker = spawn('docker', dockerArgs);
        let output = '';
        let error = '';
        docker.stdout.on('data', (data) => {
            output += data.toString();
        });

        docker.stderr.on('data', (data) => {
            error += data.toString();
        });

        docker.on('close', (code) => {
            const replaced = output.split('\n').join(';');
            const result = [replaced || error];

            if (code > 0) {
                result.push(`Your snippet failed with exit code: ${code}`);
            }

            resolve(result.join('\n'));
        });
    });
}


function loadConfig(config, name) {
    const language = config.plugins.snippets.languages[name];
    return {
        timeout: language.timeout || config.plugins.snippets.timeout,
        crop: language.crop || config.plugins.snippets.crop,
        memory: language.memory || config.plugins.snippets.memory,
        image: language.image,
        command: language.command,
    };
}

function runSnippet(web, rtm, config, secret, file) {
    const reply = text => web.files.comments.add(file.id, text);

    const fileName = crypto.randomBytes(4).toString('hex');
    const { host, path } = url.parse(file.url_private_download);
    const language = loadConfig(config, file.filetype);

    const sourceFolder = `${__dirname}/${config.plugins.snippets.folder}`;
    const fileOnDisk = `${sourceFolder}/${fileName}`;

    download(host, path, secret.token)
        .then(response => save(fileOnDisk, response))
        .then(() => execute(fileName, language, sourceFolder))
        .then(text => reply(pre(text.slice(0, language.crop))))
        .catch((error) => {
            reply(error);
            winston.error(`${META.name} - Error: ${error}`);
        });

    web.reactions.add('repeat', { file: file.id })
        .catch(() => {}); // bot already reacted supposedly
}

function supported(options, message) {
    const languages = Object.keys(options.config.plugins.snippets.languages).join(', ');

    message.reply(`I can run: ${languages}`);
}


function langConfig(options, message, who, lang) {
    try {
        const { timeout, crop, memory } = loadConfig(options.config, lang);

        message.reply(pre(`${lang}:
    Timeout  : ${timeout} seconds
    Memory   : ${memory}MB
    Crops at : ${crop} characters`));
    } catch (e) {
        message.reply(pre(`${lang} is not supported`));
    }
}


function register(bot, rtm, web, config, secret) {
    const plugin = new Plugin({ bot, rtm, web, config });
    plugin.route(/<@([^>]+)>:? snippets support/, supported, { self: true });
    plugin.route(/<@([^>]+)>:? snippets config (.*)/, langConfig, { self: true });


    rtm.on(RTM_EVENTS.MESSAGE, (message) => {
        if (message.file
                && message.file.mode === 'snippet'
                && message.subtype === 'file_share'
                && config.plugins.snippets.languages[message.file.filetype]) {
            runSnippet(web, rtm, config, secret, message.file);
        }
    });


    rtm.on(RTM_EVENTS.REACTION_ADDED, (message) => {
        if (message.user !== bot.self.id
                && message.item.type === 'file'
                && message.reaction === 'repeat') {
            web.files.info(message.item.file)
                .then(result => runSnippet(web, rtm, config, secret, result.file));
        }
    });
}


module.exports = {
    register,
    META,
};
