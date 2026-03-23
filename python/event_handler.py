import sys
import json
import time
import math as m

import pishock
#import OpenShockPY as openshock
#import buttplug


#user_info = {
#	"username": "",
#	"api_key": "",
#	"sharecode": "",
#	"device_id": "",
#}

#pi_serial_api = pishock.SerialAPI(None)
#pi_http_api = pishock.PiShockAPI(user_info["username"], user_info["api_key"])


last_death = 0.0
last_health = 0.0
max_seen_health = 0.0

vibrate_on_hurt = True
shock_on_death = True

max_shock = 50.0
min_shock = 10.0
min_shock_time = 900


def log(*args):
	print(args, flush=True, end="")


def use_pi_serial(mode, duration, intensity):
	try:
		api = pishock.SerialAPI(None)
		shockers = api.info(timeout=1000)["shockers"]
		for shocker_info in shockers:
			shocker = api.shocker(shocker_info["id"])
			try:
				match mode:
					case "shock":
						shocker.shock(duration=duration, intensity=intensity)
					case "vibrate":
						shocker.vibrate(duration=duration, intensity=intensity)
					case "beep":
						shocker.beep(duration=duration)
			except Exception as e:
				log("[python warning]", e)
	except Exception as e:
		log("[python warning]", e)


def do_shock_from_last_death(current_time):
	global last_death
	global shock_on_death
	
	dt = current_time - last_death
	log(f"{int(dt)} seconds since last death")
	if dt < 10:
		return
	if shock_on_death:
		pwr = min_shock + (max_shock - min_shock) * m.exp(pow(dt, 2) / (-333 * min_shock_time))
		log(f"shocking at intensity {int(pwr)}")
		use_pi_serial("shock", 1, pwr)
	

def handle(event, current_time):
	global last_death
	global last_health
	global max_seen_health

	global vibrate_on_hurt
	global shock_on_death
	
	global max_shock
	global min_shock
	global min_shock_time
	
	match event["type"]:
		case "info_update":
			if event["data"]["key"].startswith("roster"):
				data = json.loads(event["data"]["value"])
				if bool(data["is_local"]):
					if data["health"] > max_seen_health:
						max_seen_health = data["health"]
					
					if data["health"] < last_health:
						portion_health = (last_health - data["health"]) / max_seen_health
						log(f"health went down {int(portion_health * 100)}%")
						if vibrate_on_hurt:
							use_pi_serial("vibrate", 1.5 + portion_health * 3.5, portion_health * 100)
					
					last_health = data["health"]
						
		
		case "game_event":
			match event["data"]["key"]:
				case "match_start":
					last_death = current_time
				case "match_end":
					last_death = None
				case "death":
					if last_death != 0.0:
						do_shock_from_last_death(current_time)
					last_death = current_time
					last_health = 0.0
					
		case "pass_info":
			for key, value in event["data"].items():
				match key:
					#case "interface":
					#	pass
					#case "mode":
					#	pass
					case "max_shock":
						max_shock = float(value)
						log(f"max_shock set to {float(value)}")
					case "min_shock":
						min_shock = float(value)
						log(f"min_shock set to {float(value)}")
					case "min_shock_time":
						min_shock_time = int(value)
						log(f"min_shock_time set to {int(value)}")
					case "vibrate_on_hurt":
						vibrate_on_hurt = bool(value)
						log(f"vibrate_on_hurt set to {bool(value)}")
					case "shock_on_death":
						shock_on_death = bool(value)
						log(f"shock_on_death set to {bool(value)}")
					case _:
						log("unknown:", key, value)
					
		case "device_test":
			# DEBUG
			log("test recieved")
			#log(event["device_id"])
			#pi_http_api = pishock.PiShockAPI(user_info["username"], user_info["api_key"])
			#shocker = pi_http_api.shocker(sharecode=user_info["sharecode"], log_name="DeadShock")
			#pi_serial_api = pishock.SerialAPI(None)
			#shockers = pi_serial_api.info()["shockers"]
			#log(shockers)
			#shocker = pi_serial_api.shocker(shockers[0]["id"])
			#shocker.vibrate(duration=1, intensity=50)
			use_pi_serial("vibrate", 1, 50)
			
		case _:
			log("unknown", event)
	

if __name__ == "__main__":
	for line in sys.stdin:
		line = line.strip()
		if not line:
			continue
		
		try:
			handle(json.loads(line), time.monotonic())
		except json.JSONDecodeError as e:
			log(json.dumps({"error": str(e)}))