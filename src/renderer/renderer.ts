console.log('renderer script');

let eventLogVisible = true;
let isGameConnected = false;

//@ts-ignore
window.gep.onMessage(function(...args) {
  console.info(...args);

  let item = ''
  args.forEach(arg => {
    try {
      item = `${item} ${JSON.stringify(arg, null, 2)}`;
    } catch {
      item = `${item} ${arg}`;
    }
  })
  addMessageToTerminal(item.trim());

  // Check for game detection in the message
  const messageStr = JSON.stringify(args);
  if (messageStr.includes('register game-detected')) {
    updateGameStatus(true);
  } else if (messageStr.includes('game-exit')) {
    updateGameStatus(false);
  }

});

//@ts-ignore
window.gep.onGameEvents(function(...args) {
  console.info('game-event:', ...args);

  let item = ''
  args.forEach(arg => {
    try {
      item = `${item} ${JSON.stringify(arg, null, 2)}`;
    } catch {
      item = `${item} ${arg}`;
    }
  })
  addMessageToGameEvents(item.trim());

});

function updateGameStatus(connected: boolean) {
  isGameConnected = connected;
  const statusLight = document.querySelector('#statusLight') as HTMLElement;
  const statusText = document.querySelector('#statusText') as HTMLElement;
  
  if (statusLight) {
    if (connected) {
      statusLight.classList.add('connected');
      statusText.textContent = 'Connected';
    } else {
      statusLight.classList.remove('connected');
      statusText.textContent = 'Not Connected';
    }
  }
}


const btn = document.querySelector('#clearTerminalTextAreaBtn') as HTMLButtonElement;

btn.addEventListener('click', function(e) {
  var begin = new Date().getTime();
  const terminal = document.querySelector('#TerminalTextArea');
  terminal.innerHTML = '';
});

const gameEventsBtn = document.querySelector('#clearGameEventsTextAreaBtn') as HTMLButtonElement;

gameEventsBtn.addEventListener('click', function(e) {
  const gameEvents = document.querySelector('#GameEventsTextArea');
  gameEvents.innerHTML = '';
});

const testDeviceBtn = document.querySelector('#testDeviceBtn') as HTMLButtonElement;
testDeviceBtn.addEventListener('click', async function(e) {
  try {
    // @ts-ignore
    await window.gep.sendToPython({type: 'device_test', device_id: '21203'});
    addMessageToTerminal('Test device sent to Python');
  } catch (error) {
    addMessageToTerminal('Test device error: ' + error);
  }
});

const restartPythonBtn = document.querySelector('#restartPythonBtn') as HTMLButtonElement;
restartPythonBtn.addEventListener('click', async function(e) {
  try {
    // @ts-ignore
    await window.gep.restartPython();
    addMessageToTerminal('Python restart requested');
  } catch (error) {
    addMessageToTerminal('Python restart error: ' + error);
  }
});

const toggleEventLogBtn = document.querySelector('#toggleEventLogBtn') as HTMLButtonElement;
toggleEventLogBtn.addEventListener('click', function(e) {
  eventLogVisible = !eventLogVisible;
  const eventLogSection = document.querySelector('#eventLogSection') as HTMLElement;
  if (eventLogSection) {
    eventLogSection.style.display = eventLogVisible ? 'block' : 'none';
  }
  toggleEventLogBtn.textContent = eventLogVisible ? 'Hide Event Log' : 'Show Event Log';
});

const configForm = document.querySelector('#configForm') as HTMLFormElement;
configForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  try {
    const formData = new FormData(configForm);
    const data: { [key: string]: any } = {};
    formData.forEach((value, key) => {
      data[key] = value;
    });

    // Include unchecked checkboxes as false
    configForm.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      const cb = checkbox as HTMLInputElement;
      if (!(cb.name in data)) {
        data[cb.name] = false;
      } else {
        data[cb.name] = true; // normalize checked value to boolean
      }
    });

    const payload = { type: 'pass_info', data };
    // @ts-ignore
    await window.gep.sendToPython(payload);
    //addMessageToTerminal('Configuration sent to Python: ' + JSON.stringify(payload));
  } catch (error) {
    addMessageToTerminal('Configuration error: ' + error);
  }
});


function addMessageToTerminal(message) {
  const terminal = document.querySelector('#TerminalTextArea');
  
  // Determine message type for coloring
  let className = 'log-entry info';
  if (message.includes('error') || message.includes('Error')) {
    className = 'log-entry error';
  } else if (message.includes('success') || message.includes('sent') || message.includes('requested')) {
    className = 'log-entry success';
  } else if (message.includes('warning') || message.includes('Warning')) {
    className = 'log-entry warning';
  } else if (message.includes('[python]')) {
    className = 'log-entry python';
  }
  
  // Format with timestamp
  const timestamp = new Date().toLocaleTimeString();
  const formattedMessage = `[${timestamp}] ${message}`;
  
  terminal.append(formattedMessage + '\n');
  terminal.scrollTop = terminal.scrollHeight;
}

function addMessageToGameEvents(message) {
  const gameEvents = document.querySelector('#GameEventsTextArea');
  
  // Format with timestamp
  const timestamp = new Date().toLocaleTimeString();
  const formattedMessage = `[${timestamp}] ${message}`;
  
  gameEvents.append(formattedMessage + '\n');
  gameEvents.scrollTop = gameEvents.scrollHeight;
}

const behaviorRadios = document.querySelectorAll('[name="behavior"]');
if (behaviorRadios.length > 0) {
  behaviorRadios.forEach(
    (radio)=>{radio.addEventListener('change',(a)=>{
      const radio = a.target as HTMLInputElement;
      if (radio.checked) {
        // @ts-ignore
        window.overlay.setExclusiveModeHotkeyBehavior(radio.value);
      }
    })
  })
}

const exclusiveTypeRadios = document.querySelectorAll('[name="exclusiveType"]');
if (exclusiveTypeRadios.length > 0) {
  exclusiveTypeRadios.forEach(
    (radio)=>{radio.addEventListener('change',(a)=>{
      const radio = a.target as HTMLInputElement;
      if (radio.checked) {
        // @ts-ignore
        window.overlay.setExclusiveModeType(radio.value);
      }
    })
  })
}
