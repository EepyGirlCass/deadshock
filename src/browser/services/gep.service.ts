import { app as electronApp } from 'electron';
import { overwolf } from '@overwolf/ow-electron' // TODO: wil be @overwolf/ow-electron
import EventEmitter from 'events';
import { match } from 'assert';
import { isStringObject } from 'util/types';
import { get } from 'jquery';

const app = electronApp as overwolf.OverwolfApp;

/**
 * Service used to register for Game Events,
 * receive games events, and then send them to a window for visual feedback
 *
 */
export class GameEventsService extends EventEmitter {
  private gepApi: overwolf.packages.OverwolfGameEventPackage;
  private activeGame = 0;
  private gepGamesId: number[] = [];

  // Deadlock gamestate
  private lastHealth: number | null = null;
  private inValidGame: boolean = false;
  private inActiveGame: boolean = true;
  private get inGame() {
    return this.inValidGame && this.inActiveGame;
  }

  // PiShock WebSocket
  private webSocket: WebSocket = new WebSocket("wss://broker.pishock.com/v2?url");
  private getWebSocketCommand(mode: string, intensity: number, ms: number) {
    //return JSON.stringify({ "Operation":"PING" });
    return JSON.stringify({
      "Operation": "PUBLISH",
      "PublishCommands":
      [{
        "Target": "c{clientId}-ops", //for example c{clientId}-ops or c{clientId}-sops-{sharecode}
        "Body": {
          "id": "21203",
          "m": mode, // 'v', 's', 'b', or 'e'
          "i": intensity.toString(), // Could be vibIntensity, shockIntensity or a randomized value
          "d": ms.toString(), // Calculated duration in milliseconds
          "r": "true", // true or false, always set to true.
          "l": {
            //"u": "<userID>", // User ID from first step
            "ty": "api", // 'sc' for ShareCode, 'api' for Normal
            "w": "false", // true or false, if this is a warning vibrate, it affects the logs
            "h": "false", // true if button is held or continuous is being sent.
            "o": "Deadlock", // send to change the name shown in the logs.
          }
        }
      }]
    });
  }

  constructor() {
    super();
    this.registerOverwolfPackageManager();
    this.webSocket.onmessage = (event) => {
      //const response = JSON.parse(data.toString());
      console.log(event.data);
    };
  }


  /**
   *  for gep supported games goto:
   *  https://overwolf.github.io/api/electron/game-events/
   *   */
  public registerGames(gepGamesId: number[]) {
    this.emit('log', `register to game events for `, gepGamesId);
    this.gepGamesId = gepGamesId;
  }

  /**
   *
   */
  public async setRequiredFeaturesForAllSupportedGames() {
    await Promise.all(this.gepGamesId.map(async (gameId) => {
      this.emit('log', `set-required-feature for: ${gameId}`);
      await this.gepApi.setRequiredFeatures(gameId, null);
    }));
  }

  /**
   *
   */
  public async getInfoForActiveGame(): Promise<any> {
    if (this.activeGame == 0) {
      return 'getInfo error - no active game';
    }

    return await this.gepApi.getInfo(this.activeGame);
  }

  /**
   * Register the Overwolf Package Manager events
   */
  private registerOverwolfPackageManager() {
    // Once a package is loaded
    app.overwolf.packages.on('ready', (e, packageName, version) => {
      // If this is the GEP package (packageName serves as a UID)
      if (packageName !== 'gep') {
        return;
      }

      this.emit('log', `gep package is ready: ${version}`);

      // Prepare for Game Event handling
      this.onGameEventsPackageReady();

      this.emit('ready');
    });
  }

  /**
   * Register listeners for the GEP Package once it is ready
   *
   * @param {overwolf.packages.OverwolfGameEventPackage} gep The GEP Package instance
   */
  private async onGameEventsPackageReady() {
    // Save package into private variable for later access
    this.gepApi = app.overwolf.packages.gep;

    // Remove all existing listeners to ensure a clean slate.
    // NOTE: If you have other classes listening on gep - they'll lose their
    // bindings.
    this.gepApi.removeAllListeners();

    // If a game is detected by the package
    // To check if the game is running in elevated mode, use `gameInfo.isElevate`
    this.gepApi.on('game-detected', (e, gameId, name, gameInfo) => {
      // If the game isn't in our tracking list

      if (!this.gepGamesId.includes(gameId)) {
        // Stops the GEP Package from connecting to the game
        this.emit('log', 'gep: skip game-detected', gameId, name, gameInfo.pid);
        return;
      }

      /// if (gameInfo.isElevated) {
      //   // Show message to User?
      //   return;
      // }

      this.emit('log', 'gep: register game-detected', gameId, name, gameInfo);
      e.enable();
      this.activeGame = gameId;

      // in order to start receiving event/info
      // setRequiredFeatures should be set
    });

    // undocumented (will add it fir next version) event to track game-exit
    // from the gep api
    //@ts-ignore
    this.gepApi.on('game-exit',(e, gameId, processName, pid) => {
      console.log('gep game exit', gameId, processName, pid);
    });

    // If a game is detected running in elevated mode
    // **Note** - This fires AFTER `game-detected`
    this.gepApi.on('elevated-privileges-required', (e, gameId, ...args) => {
      this.emit('log',
        'elevated-privileges-required',
        gameId,
        ...args
      );

      // TODO Handle case of Game running in elevated mode (meaning that the app also needs to run in elevated mode in order to detect events)
    });

    // When a new Info Update is fired
    this.gepApi.on('new-info-update', (e, gameId, ...args) => {
      this.emit('log', 'info-update', gameId, ...args);

      args.forEach(arg => {

        switch (arg.category) {

          case ("game_info"):
            switch (arg.key) {

              case ("game_mode"):
                let data = JSON.parse(arg.value);
                this.inValidGame = data.game_mode == "Normal" || data.game_mode == "StreetBrawl";
                break;
              
              case ("phase"):
                this.inActiveGame = arg.value == "GameInProgress";
                break;
              
            }
            break;
          
          case ("match_info"):
            if (arg.key.startsWith("roster")) {
              let data = JSON.parse(arg.value);

              // We only care about the local player
              if (!data.is_local)
                break;

              if (data.health < this.lastHealth) {
                if (this.inGame) {
                  console.log("sending websocket command");
                  this.webSocket.send(this.getWebSocketCommand("v", 50, 1000));
                }
              }

              this.lastHealth = data.health;
            }
            break;
          
        }
      });
    });

    // When a new Game Event is fired
    this.gepApi.on('new-game-event', (e, gameId, ...args) => {
      //this.emit('log', 'new-event', gameId, ...args);
    });

    // If GEP encounters an error
    this.gepApi.on('error', (e, gameId, error, ...args) => {
      this.emit('log', 'gep-error', gameId, error, ...args);

      this.activeGame = 0;
    });
  }
}
