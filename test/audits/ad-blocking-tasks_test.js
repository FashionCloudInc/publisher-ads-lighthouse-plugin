const AdBlockingTasks = require('../../audits/ad-blocking-tasks');
const {expect} = require('chai');

const generateTask = ([start, end], groupLabel, eventName) => ({
  event: {eventName, ts: start * 1000, args: {data: {url: 'script.js'}}},
  group: {label: groupLabel},
  selfTime: end - start,
  startTime: start,
  endTime: end,
  children: [],
  attributableURLs: [],
});

const generateReq = ([start, response, end], id, url) => ({
  responseReceivedTime: response / 1000,
  startTime: start / 1000,
  endTime: end / 1000,
  requestId: id,
  url,
  resourceType: 'Script',
});

const makeArtifacts = (requests, tasks, offset = 0) => {
  const traceEvents = requests.map(({startTime, requestId}) => ({
    ts: (startTime * 1000 + offset) * 1000,
    name: 'ResourceSendRequest',
    args: {data: {requestId}},
  }));

  return {
    devtoolsLogs: {[AdBlockingTasks.DEFAULT_PASS]: []},
    requestNetworkRecords: () => Promise.resolve(requests),
    requestMainThreadTasks: async () => tasks,
    traces: {defaultPass: {traceEvents}},
  };
};

describe('AdBlockingTasks', async () => {
  describe('rawValue', async () => {
    const testCases = [
      {
        desc: 'should succeed if there are no ad requests',
        tasks: [
          generateTask([0, 40], 'Parse HTML'),
          generateTask([140, 160], 'Script Evaluation'),
          generateTask([200, 350], 'Script Evaluation'),
          generateTask([500, 520], 'Script Evaluation'),
        ],
        requests: [
          generateReq([110, 150, 160], 1, 'https://example.com'),
          generateReq([210, 300, 360], 2, 'https://test.com'),
        ],
        expectedValue: true,

      },
      {
        desc: 'should succeed if there are no long tasks',
        tasks: [
          generateTask([0, 40], 'Parse HTML'),
          generateTask([140, 160], 'Script Evaluation'),
          generateTask([300, 310], 'Script Evaluation'),
          generateTask([500, 520], 'Script Evaluation'),
        ],
        requests: [
          generateReq([110, 150, 160], 1, 'https://googletagservices.com'),
          generateReq([210, 300, 310], 2, 'https://doubleclick.net'),
          generateReq([410, 500, 510], 3, 'https://googlesyndication.com'),
        ],
        expectedValue: true,

      },
      {
        desc: 'should succeed if there is no long tasks overlap',
        tasks: [
          generateTask([0, 100], 'Parse HTML'),
          generateTask([200, 300], 'Script Evaluation'),
          generateTask([450, 600], 'Script Evaluation'),
          generateTask([750, 900], 'Script Evaluation'),
        ],
        requests: [
          generateReq([110, 150, 160], 1, 'https://googletagservices.com'),
          generateReq([310, 400, 410], 2, 'https://doubleclick.net'),
          generateReq([610, 700, 710], 3, 'https://googlesyndication.com'),
        ],
        expectedValue: true,

      },
      {
        desc: 'should fail if any long task blocks and ad request',
        tasks: [
          generateTask([0, 40], 'Parse HTML'),
          generateTask([140, 160], 'Script Evaluation'),
          generateTask([300, 360], 'Script Evaluation'), // Long Task
          generateTask([500, 520], 'Script Evaluation'),
        ],
        requests: [
          generateReq([110, 150, 160], 1, 'https://googletagservices.com'),
          generateReq([210, 300, 360], 2, 'https://doubleclick.net'), // Block
          generateReq([410, 500, 510], 3, 'https://googlesyndication.com'),
        ],
        expectedValue: false,

      },
      {
        desc: 'should skip long tasks without any script url',
        tasks: [
          generateTask([0, 40], 'Parse HTML'),
          generateTask([140, 160], 'Script Evaluation'),
          generateTask([300, 360], 'Script Evaluation').event.args = {}, // Long Task
          generateTask([500, 520], 'Script Evaluation'),
        ],
        requests: [
          generateReq([110, 150, 160], 1, 'https://googletagservices.com'),
          generateReq([210, 300, 360], 2, 'https://doubleclick.net'), // Block
          generateReq([410, 500, 510], 3, 'https://googlesyndication.com'),
        ],
        expectedValue: true,
      },
      {
        desc: 'should handle offsets in the network timeline',
        tasks: [
          generateTask([0, 40], 'Parse HTML'),
          generateTask([140, 160], 'Script Evaluation'),
          generateTask([300, 360], 'Script Evaluation'), // Long Task
          generateTask([500, 520], 'Script Evaluation'),
        ],
        requests: [
          generateReq([1110, 1150, 1160], 1, 'https://googletagservices.com'),
          generateReq([1210, 1300, 1360], 2, 'https://doubleclick.net'), // Block
          generateReq([1410, 1500, 1510], 3, 'https://googlesyndication.com'),
        ],
        offset: -1000,
        expectedValue: false,

      },
      {
        desc: 'should handle network requests out of order',
        tasks: [
          generateTask([0, 40], 'Parse HTML'),
          generateTask([140, 160], 'Script Evaluation'),
          generateTask([300, 360], 'Script Evaluation'), // Long Task
          generateTask([500, 520], 'Script Evaluation'),
        ],
        requests: [
          generateReq([1410, 1500, 1510], 3, 'https://googlesyndication.com'),
          generateReq([1110, 1150, 1160], 1, 'https://googletagservices.com'),
          generateReq([1210, 1300, 1360], 2, 'https://doubleclick.net'), // Block
        ],
        offset: -1000,
        expectedValue: false,
      },
    ];

    for (const {desc, tasks, requests, offset = 0, expectedValue}
      of testCases) {
      it(`${desc}`, async () => {
        const artifacts = makeArtifacts(requests, tasks, offset);

        const result = await AdBlockingTasks.audit(artifacts);

        expect(result).to.have.property('rawValue', expectedValue);
      });
    }
  });
});