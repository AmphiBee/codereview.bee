'use strict';

import './styles.css';
import { parse } from 'node-html-parser';
import { ChatGPTAPI } from 'chatgpt';

var parsediff = require('parse-diff');

const spinner = `
        <svg aria-hidden="true" class="w-4 h-4 text-gray-200 animate-spin dark:text-slate-200 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
          <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
        </svg>
`
const checkmark = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-green-600">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
`
const xcircle = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 text-red-600">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
`

function inProgress(ongoing, failed = false, rerun = true) {
  if (ongoing) {
    document.getElementById('status-icon').innerHTML = spinner
    document.getElementById('rerun-btn').classList.add("invisible");
    document.getElementById('codeball-link').classList.add("invisible");
  } else {
    if (failed) {
      document.getElementById('status-icon').innerHTML = xcircle
    } else {
      document.getElementById('status-icon').innerHTML = checkmark
    }
    if (rerun) {
      document.getElementById('rerun-btn').classList.remove("invisible");
      document.getElementById('codeball-link').classList.remove("invisible");
    }
  }
}

async function getApiKey() {
  let options = await new Promise((resolve) => {
    chrome.storage.sync.get('openai_apikey', resolve);
  });
  console.log(options);
  if (!options || !options['openai_apikey']) {
    throw new Error("UNAUTHORIZED");
  }
  return options['openai_apikey'];
}

async function callChatGPT(messages, callback, onDone) {
  let apiKey;
  try {
    apiKey = await getApiKey();
  } catch (e) {
    callback('Please add your Open AI API key to the settings of this Chrome Extension.');
    onDone();
    return;
  }

  const api = new ChatGPTAPI({
    apiKey: apiKey,
    systemMessage: `Tu es un relecteur de code informatique, donne des conseils d'améliorations sur le code donné. Ne te présente pas et réponds en français`,
  })

  let res
  let iterations = messages.length;
  for (const message of messages) {
    iterations--;
    try {
      // Last prompt
      var options = {};
      // If we have no iterations left, it means its the last of our prompt messages.
      if (iterations == 0) {
        options = {
          onProgress: (partialResponse) => callback(partialResponse.text),
        }
      }
      // In progress
      else {
        options = {
          onProgress: () => callback("Envoi du code... Nombre de prompts à envoyer: " + iterations + ". Merci de patienter..."),
        }
      }

      if (res) {
        options.parentMessageId = res.id
      }
      res = await api.sendMessage(message, options)
    } catch (e){
      callback(String(e));
      onDone();
      return;
    }
  };

  onDone();
}

const showdown = require('showdown');
const converter = new showdown.Converter()

async function reviewPR(diffPath, context, title) {
  inProgress(true)
  document.getElementById('result').innerHTML = ''
  chrome.storage.session.remove([diffPath])


  let promptArray = [];
  // Fetch the patch from our provider.
  let patch = await fetch (diffPath).then((r) => r.text())
  let warning = '';
  let patchParts = [];

  promptArray.push(`Le changement a le titre suivant: ${title}.

    Ta tâche:
    - Fais une revue du code et donne une analyse
    - S'il y a des bugs, mets les en valeur
    - Provide details on missed use of best-practices. Donne des détails sur des oublis des meilleures pratiques
    - Est-ce que le code fait ce qui est décrit dans les messages ?
    - Ne donne pas d'informations sur les problèmes mineurs et pinailleries
    - Utilise des listes à puces si tu as plusieurs commentaires à faire
    - Donne des recommandations sur la sécurité si besoin

    Les changements (diffs) sont donnés au format unidiff.
    Ne donne pas ta réponse pour le moment. Je vais ajouter une description des changements dans un autre message.`
  );

  promptArray.push(`Une description a été donnée pour t'aider à comprendre pourquoi ces changements ont été effectués.
    La description a été faite au format Markdown. Ne donne pas encore ta réponse. Je vais ajouter les changements de code dans un nouveau message.

    ${context}`);

  // Remove binary files as those are not useful for ChatGPT to provide a review for.
  // TODO: Implement parse-diff library so that we can remove large lock files or binaries natively.
  const regex = /GIT\sbinary\spatch(.*)literal\s0/mgis;
  patch = patch.replace(regex,'')

  // Separate the patch in different pieces to give ChatGPT more context.
  // Additionally, truncate the part of the patch if it is too big for ChatGPT to handle.
  // https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
  // ChatGPT 3.5 has a maximum token size of 4096 tokens https://platform.openai.com/docs/models/gpt-3-5
  // We will use the guidance of 1 token ~= 4 chars in English, minus 1000 chars to be sure.
  // This means we have 16384, and let's reduce 1000 chars from that.
  var files = parsediff(patch);

    // Rebuild our patch as if it were different patches
    files.forEach(function(file) {

      // Ignore lockfiles
    if (file.from.includes("lock.json")) {
      return;
    }

    var patchPartArray = [];

    patchPartArray.push("```diff");
    if ("from" in file && "to" in file) {
      patchPartArray.push("diff --git a" + file.from + " b"+ file.to);
    }
    if ("new" in file && file.new === true && "newMode" in file) {
      patchPartArray.push("new file mode " + file.newMode);
    }
    if ("from" in file) {
      patchPartArray.push("--- " + file.from);
    }
    if ("to" in file) {
      patchPartArray.push("+++ " + file.to);
    }
    if ("chunks" in file) {
      patchPartArray.push(file.chunks.map(c => c.changes.map(t => t.content).join("\n")));
    }
    patchPartArray.push("```");
    patchPartArray.push("\nNe donne pas encore de réponse. Je vais confirmer quand tous les changements ont été envoyés.");

    var patchPart = patchPartArray.join("\n");
    if (patchPart.length >= 15384) {
      patchPart = patchPart.slice(0, 15384)
      warning = 'Certaines parties du patch ont été tronquées car elles dépassaient 4096 jetons ou 15384 caractères. La revue pourrait ne pas être cmomplète.'
    }
    patchParts.push(patchPart);
  });

  patchParts.forEach(part => {
    promptArray.push(part);
  });

  promptArray.push("Toutes les modifications de code ont été fournies. Merci de fournir ta revue de code, basée sur toutes les modifications, le contexte et le titre fournit.");

  console.log(promptArray)

  // Send our prompts to ChatGPT.
  callChatGPT(
    promptArray,
    (answer) => {
      document.getElementById('result').innerHTML = converter.makeHtml(answer + " \n\n" + warning)
    },
    () => {
      chrome.storage.session.set({ [diffPath]: document.getElementById('result').innerHTML })
      inProgress(false)
    }
  )
}

async function run() {

  // Get current tab
  let tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  let prUrl = document.getElementById('pr-url')
  prUrl.textContent = tab.url

  let diffPath
  let provider = ''
  let error = null
  let tokens = tab.url.split('/')
  let context = ''
  let title = tab.title

  // Simple verification if it would be a self-hosted GitLab instance.
  // We verify if there is a meta tag present with the content "GitLab".
  let isGitLabResult = (await chrome.scripting.executeScript({
    target:{tabId: tab.id, allFrames: true},
    func: () => { return document.querySelectorAll('meta[content="GitLab"]').length }
  }))[0];

  if (tokens[2] === 'github.com') {
    provider = 'GitHub'
  }
  else if ("result" in isGitLabResult && isGitLabResult.result == 1) {
    provider = 'GitLab'
  }

  if (provider === 'GitHub' && tokens[5] === 'pull') {
    // The path towards the patch file of this change
    diffPath = `https://patch-diff.githubusercontent.com/raw/${tokens[3]}/${tokens[4]}/pull/${tokens[6]}.patch`;
    // The description of the author of the change
    // Fetch it by running a querySelector script specific to GitHub on the active tab
    const contextExternalResult = (await chrome.scripting.executeScript({
      target:{tabId: tab.id, allFrames: true},
      func: () => { return document.querySelector('.markdown-body').textContent }
    }))[0];

    if ("result" in contextExternalResult) {
      context = contextExternalResult.result;
    }
  }
  else if (provider === 'GitLab' && tab.url.includes('/-/merge_requests/')) {
    // The path towards the patch file of this change
    diffPath = tab.url + '.patch';
    // The description of the author of the change
    // Fetch it by running a querySelector script specific to GitLab on the active tab
    const contextExternalResult = (await chrome.scripting.executeScript({
      target:{tabId: tab.id, allFrames: true},
      func: () => { return document.querySelector('.description textarea').getAttribute('data-value') }
    }))[0];

    if ("result" in contextExternalResult) {
      context = contextExternalResult.result;
    }
  }
  else {
    if (provider) {
      error = 'Please open a specific Pull Request or Merge Request on ' + provider
    }
    else {
      error = 'Only GitHub or GitLab (SaaS & self-hosted) are supported.'
    }
  }

  if (error != null) {
    document.getElementById('result').innerHTML = error
    inProgress(false, true, false);
    await new Promise((r) => setTimeout(r, 4000));
    window.close();
    return // not a pr
  }

  inProgress(true)

  document.getElementById("rerun-btn").onclick = () => {
    reviewPR(diffPath, context, title)
  }

  chrome.storage.session.get([diffPath]).then((result) => {
    if (result[diffPath]) {
      document.getElementById('result').innerHTML = result[diffPath]
      inProgress(false)
    } else {
      reviewPR(diffPath, context, title)
    }
  })
}

run();
