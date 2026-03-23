import { app as electronApp } from 'electron';
import { overwolf } from '@overwolf/ow-electron' // TODO: wil be @overwolf/ow-electron
import EventEmitter from 'events';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

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
  private get inGame() {return this.inValidGame && this.inActiveGame;}


  constructor() {
    super();
    this.registerOverwolfPackageManager();
    this.startPython();
  }

  // Python subprocess
  // --------------------------------------------------
  private pyProcess: ChildProcess | null = null;

  private startPython() {
    const { cmd, args } = electronApp.isPackaged
      ? {
          cmd: path.join(process.resourcesPath, 'python',
            process.platform === 'win32' ? 'event_handler.exe' : 'event_handler'),
          args: [] as string[]
        }
      : {
          cmd: 'python',
          args: [path.join(electronApp.getAppPath(), 'python', 'event_handler.py')]
        };

    this.pyProcess = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.pyProcess.stdout?.on('data', (d: Buffer) =>
      d.toString().split('\n').filter(Boolean).forEach(line => {
        try { this.emit('log', '[python]', JSON.parse(line)); }
        catch { this.emit('log', '[python raw]', line); }
      })
    );

    this.pyProcess.stderr?.on('data', (d: Buffer) =>
      console.error('[python err]', d.toString())
    );

    this.pyProcess.on('close', code => {
      this.emit('log', '[python] exited', code);
      this.pyProcess = null;
      // Automatically restart Python after a short delay
      setTimeout(() => this.restartPython(), 1000);
    });
  }

  public sendToPython(payload: object) {
    this.pyProcess?.stdin?.write(JSON.stringify(payload) + '\n');
  }

  public restartPython() {
    // Kill existing process if any
    if (this.pyProcess) {
      this.pyProcess.kill();
      this.pyProcess = null;
    }
    // Start new process
    this.emit('log', '[python] restarting...');
    this.startPython();
  }

  // --------------------------------------------------


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
      this.emit('log-events', 'info-update', gameId, ...args);
      args.forEach(arg => {this.sendToPython({ "type" : "info_update", "data" : arg })});
    });

    // When a new Game Event is fired
    this.gepApi.on('new-game-event', (e, gameId, ...args) => {
      this.emit('log-events', 'new-event', gameId, ...args);
      args.forEach(arg => {this.sendToPython({ "type" : "game_event", "data" : arg })});
    });

    // If GEP encounters an error
    this.gepApi.on('error', (e, gameId, error, ...args) => {
      this.emit('log', 'gep-error', gameId, error, ...args);

      this.activeGame = 0;
    });
  }
}
