import { GoogleAuth } from 'google-auth-library';

import { createRequire } from 'module';

import { fetchRetry } from './fetchRetry.js';
import fs from 'fs';

// DELAY FN
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

//google API details
const projectId = process.env.PROJECT_ID;
const endAPIPoint = process.env.API_ENDPOINT;
const googTxtMod = process.env.BISON_TEXT;
let authCode = null;
const googAPIKey = process.env.API_KEY;
const googChatMod = process.env.BISON_CHAT;

//update google access token
let isUpdatingToken = false;
let isFirstCall = true;

const require = createRequire(import.meta.url);

//const serviceAccount = require(`./googl-access-key.json`);
const serviceAccountPath = './googl-access-key.json';
const serviceAccount = require(serviceAccountPath);

//get and update google access token
async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
    scopes: 'https://www.googleapis.com/auth/cloud-platform',
  });
  const token = await auth.getAccessToken();
  authCode = token;
  await delay(2000);
  console.log(`have new token`);
  return token;
}

// Function to refresh the access token
async function refreshToken() {
  try {
    const token = await getAccessToken();
    authCode = token;
    console.log('Access token refreshed:');
  } catch (error) {
    console.error('Error refreshing access token:', error);
  }
}

//Google text-bison@001
const googTxtBison = async (primer, str, counter, params) => {
  let repeats = counter ? counter : 100;
  const endpointURL = `https://${endAPIPoint}/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${googTxtMod}:predict`;
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authCode}`,
  });
  const nameBody = {
    instances: [
      {
        content: `${primer}\n\nSTATEMENT: ${str}\n\nANSWER: `,
      },
    ],
    parameters: params,
  };

  const options = {
    method: 'POST',
    body: JSON.stringify(nameBody),
    headers: headers,
  };
  //console.log(options.body);
  let choiceCount = [];
  for (let i = 0; i < repeats; i++) {
    try {
      let data = await fetchRetry(endpointURL, options, 200, 3000, 100000);
      if (data === `update google token`) {
        throw new Error(`update google token`);
      }
      choiceCount.push(data.predictions[0].content);
      //progressBar.interrupt(`got goog call`);
      //console.log(`text-Bison Q:${qNum} call no. ${i + 1} / ${repeats}`);
    } catch (error) {
      if (error.message === `update google token`) {
        const newHeaders = new Headers({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authCode}`,
        });
        const newOptions = {
          method: 'POST',
          body: JSON.stringify(nameBody),
          headers: newHeaders,
        };
        let dataErr = await fetchRetry(
          endpointURL,
          newOptions,
          50,
          100000,
          100000
        );
        //console.log(`data: ${dataErr}`);
        if (dataErr.predictions) {
          choiceCount.push(dataErr.predictions[0].content);
        } else {
          choiceCount.push(null);
          console.log(`google auth error`);
        }
        //console.log(`text-Bison Q:${qNum} call no. ${i + 1} / ${repeats}`);
      } else {
        progressBar.interrupt(`error fetching from google: ${error}`);
        console.log(`Error fetching from google: ${error}`);
      }
    }
  }
  let returnData = { model: `text-bison@001`, choices: choiceCount };
  return returnData;
};

export const googBisonQuick = async (
  arr,
  cnt,
  sampleCnt,
  samplePerQ,
  params
) => {
  await getAccessToken();
  // Schedule token refresh at regular intervals
  setInterval(refreshToken, 2400000);
  let repeats = sampleCnt ? sampleCnt : 100;
  let resCount = cnt ? cnt : 100;
  const startTime = performance.now();
  const date = new Date();
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  const formattedDate = `D:${day}M:${month}Y:${year}`;
  const dateString = date.toISOString();
  let obj = {
    sampleCounts: samplePerQ,
    date: formattedDate,
    timeStamp: dateString,
    questions: [],
    elapsedTime: 0,
    params: params,
  };
  // Create an array of promises for each object in the input array
  const promises = arr.map(async (item, index) => {
    obj.questions.push({ Q: item.code, answers: [] });
    let errCount = 0;

    // Create an array of promises for each iteration
    const iterationPromises = [];
    for (let c = 0; c < resCount; c++) {
      iterationPromises.push(
        googTxtBison(item.primer, item.question, repeats, params)
      );
    }

    // Wait for all iterations to complete
    const responses = await Promise.all(iterationPromises);

    if (index === 0) {
      obj.model = responses[0].model;
    }

    for (const chatResponse of responses) {
      for (let r = 0; r < chatResponse.choices.length; r++) {
        if (!Number(chatResponse.choices[r])) {
          errCount++;
          obj.questions[index].errorResponses.push(chatResponse.choices[r]);
        } else {
          obj.questions[index].answers.push(Number(chatResponse.choices[r]));
        }
      }
    }

    obj.questions[index].nonValid = errCount;
    const sum = obj.questions[index].answers.reduce(
      (accumulator, currentValue) => {
        return accumulator + currentValue;
      }
    );
    const average = sum / obj.questions[index].answers.length;
    obj.questions[index].ave = average;
    obj.questions[index].validCount = obj.questions[index].answers.length;
  });

  await Promise.all(promises);

  const endTime = performance.now();
  obj.elapsedTime = endTime - startTime;
  const dirPath = `./data/${obj.model}`;

  // Create the directory if it doesn't exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
  const fileData = dateString.replace(/:/g, '~');
  fs.appendFile(
    `${dirPath}/${obj.model}_${fileData}.json`,
    JSON.stringify(obj),
    (err) => {
      console.log(`Done text-bison-001 in ${obj.elapsedTime} ms.`);
      if (err) throw err;
    }
  );
};

//Google chat-bison@001
const googChatBison = async (primer, str, counter, params) => {
  let repeats = counter ? counter : 100;
  const endpointURL = `https://${endAPIPoint}/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${googChatMod}:predict`;
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authCode}`,
  });
  const nameBody = {
    instances: [
      {
        context: primer,
        examples: [],
        messages: [{ author: `user`, content: str }],
      },
    ],
    parameters: params,
  };
  console.log(nameBody);

  const options = {
    method: 'POST',
    body: JSON.stringify(nameBody),
    headers: headers,
  };
  let choiceCount = [];
  for (let i = 0; i < repeats; i++) {
    try {
      let data = await fetchRetry(endpointURL, options, 200, 3000, 100000);
      console.log(data.predictions[0].candidates[0].content);
      if (data === `update google token`) {
        throw new Error(`update google token`);
      }
      choiceCount.push(data.predictions[0].candidates[0].content);
    } catch (error) {
      if (error.message === `update google token`) {
        const newHeaders = new Headers({
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authCode}`,
        });
        const newOptions = {
          method: 'POST',
          body: JSON.stringify(nameBody),
          headers: newHeaders,
        };
        let dataErr = await fetchRetry(
          endpointURL,
          newOptions,
          50,
          100000,
          100000
        );
        //console.log(`data: ${dataErr}`);
        if (dataErr.predictions) {
          choiceCount.push(dataErr.predictions[0].candidates[0].content);
        } else {
          choiceCount.push(null);
          console.log(`google auth error`);
        }
        //console.log(`text-Bison Q:${qNum} call no. ${i + 1} / ${repeats}`);
      } else {
        console.log(`Error fetching from google: ${error}`);
      }
    }
  }
  let returnData = { model: `chat-bison@001`, choices: choiceCount };
  return returnData;
};

export const googChatBisonQuick = async (
  arr,
  cnt,
  sampleCnt,
  samplePerQ,
  params
) => {
  await getAccessToken();
  // Schedule token refresh at regular intervals
  setInterval(refreshToken, 2400000);
  let repeats = sampleCnt ? sampleCnt : 100;
  let resCount = cnt ? cnt : 100;
  const startTime = performance.now();
  const date = new Date();
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);
  const formattedDate = `D:${day}M:${month}Y:${year}`;
  const dateString = date.toISOString();
  let obj = {
    sampleCounts: samplePerQ,
    date: formattedDate,
    timeStamp: dateString,
    questions: [],
    elapsedTime: 0,
    params: params,
  };
  // Create an array of promises for each object in the input array
  const promises = arr.map(async (item, index) => {
    obj.questions.push({ Q: item.code, answers: [] });
    let errCount = 0;

    // Create an array of promises for each iteration
    const iterationPromises = [];
    for (let c = 0; c < resCount; c++) {
      iterationPromises.push(
        googChatBison(item.primer, item.question, repeats, params)
      );
    }

    // Wait for all iterations to complete
    const responses = await Promise.all(iterationPromises);

    if (index === 0) {
      obj.model = responses[0].model;
    }

    for (const chatResponse of responses) {
      for (let r = 0; r < chatResponse.choices.length; r++) {
        if (!Number(chatResponse.choices[r])) {
          errCount++;
          obj.questions[index].errorResponses.push(chatResponse.choices[r]);
        } else {
          obj.questions[index].answers.push(Number(chatResponse.choices[r]));
        }
      }
    }

    obj.questions[index].nonValid = errCount;
    const sum = obj.questions[index].answers.reduce(
      (accumulator, currentValue) => {
        return accumulator + currentValue;
      }
    );
    const average = sum / obj.questions[index].answers.length;
    obj.questions[index].ave = average;
    obj.questions[index].validCount = obj.questions[index].answers.length;
  });

  await Promise.all(promises);

  const endTime = performance.now();
  obj.elapsedTime = endTime - startTime;
  const dirPath = `./data/${obj.model}`;

  // Create the directory if it doesn't exist
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
  const fileData = dateString.replace(/:/g, '~');
  fs.appendFile(
    `${dirPath}/${obj.model}_${fileData}.json`,
    JSON.stringify(obj),
    (err) => {
      console.log(`Done chat-bison-001 in ${obj.elapsedTime} ms.`);
      if (err) throw err;
    }
  );
};
