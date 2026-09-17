import secrets
import json
import os
import time

TOKENS_FILE = "database.json"
ROOMS_FILE = "rooms.json"

def generate_token(l): 
    return secrets.token_hex(l)

def add_client_token(client_name, token=None, rooms=None, admin=False):
    """Add or update a client token in database.json"""
    if token is None or len(token) < 3:
        l = int(token) if token else 32
        token = generate_token(l)

    tokens = {"users": {}, "validTokens": []}
    if os.path.exists(TOKENS_FILE):
        try:
            with open(TOKENS_FILE, 'r') as f:
                tokens = json.load(f)
        except json.JSONDecodeError:
            pass

    if os.path.exists(ROOMS_FILE):
        try:
            with open(ROOMS_FILE, 'r') as f:
                roomsDB = json.load(f)
        except json.JSONDecodeError:
            pass

    if rooms is not None:
        if roomsDB is None: roomsDB = {}
        for r in rooms:
            r_str = str(r)
            room = roomsDB.get(r_str)

            if room is None:
                room = {
                    "alias": "room #"+r_str,
                    "icon": None,
                    "members": [token],
                    "size": 1,
                    "created": {
                        "creator": token,
                        "timestamp": int(time.time())
                    }
                }
            else:
                if token not in room["members"]:
                    room["members"].append(token)
                    room["size"] = len(room["members"])
            roomsDB[r_str] = room

    if "users" not in tokens:
        tokens["users"] = {}
    if "validTokens" not in tokens:
        tokens["validTokens"] = []


    sorted_rooms = sorted(rooms) if rooms else []
    tokens["users"][token] = {"name": client_name, "rooms": sorted_rooms}

    if token not in tokens["validTokens"]:
        tokens["validTokens"].append(token)

    if admin:
        tokens.setdefault("admins", []).append(token)

    with open(TOKENS_FILE, 'w') as f:
        json.dump(tokens, f, indent=2)
    with open(ROOMS_FILE, "w") as f:
        json.dump(roomsDB, f, indent=2)

    return token

def list_clients():
    """List all authorized clients."""
    if os.path.exists(TOKENS_FILE):
        try:
            with open(TOKENS_FILE, 'r') as f:
                data = json.load(f)
                return data.get("users", {})
        except json.JSONDecodeError:
            pass
    return {}

def sync_databases():
    with open(TOKENS_FILE, 'r') as f: tokens = json.load(f)
    with open(ROOMS_FILE, "r") as f: rooms = json.load(f)
    users = tokens["users"]

    rooms_new = {k:{"alias": v.get("alias", "room #"+str(k)),"icon": v.get("icon","default-pfp.jpeg"), "members": [], "size": 0, "created": v.get("created",{})} for k,v in rooms.items()}
    defaultRoom = lambda r: {"alias": "room #"+str(r),"icon": None, "members": [], "size": 0, "created": {}}
    for token in users.keys():
        try:
            rooms = users[token]["rooms"]
        except:
            rooms = []
            print(f"skipping user {token} because of unexpected format")
        rooms = [str(i)for i in rooms]

        for room in rooms:
            if not rooms_new.get(room): rooms_new[room] = defaultRoom(room)
            rooms_new[room]["members"].append(token)
            rooms_new[room]["size"] += 1

    with open(ROOMS_FILE, "w") as f: json.dump(rooms_new, f, indent=2)
    print("✓ Successfully synchronized rooms DB")

def clean_databases():
    users_to_delete = ["test","user","guest"]

    with open(TOKENS_FILE, 'r') as f: tokens_old = json.load(f)
    tokens_new = {}
    validTokens_old = tokens_old["validTokens"]
    validTokens_new = []
    users_old = tokens_old["users"]
    users_new = {}

    for token in users_old.keys():
        user = users_old[token]
        
        if not isinstance(user, dict):
            print(f"dropped invalid format user {token}, read: {user}")
            continue

        if user["name"] in users_to_delete:
            print(f"dropped user {token} by policy for name {user["name"]}")
            continue

        rooms = user.get("rooms")
        if not isinstance(rooms, list) or not rooms:
            print(f"invalid rooms assertion to user {token}, read: {rooms}. asserted room 0.")
            rooms = [0]
        user["rooms"] = rooms
        users_new[token] = user
        validTokens_new.append(token)

    tokens_new = {"validTokens": validTokens_new, "users": users_new}
    if not input("if you really wish to continue, press [Enter]"):
        with open(TOKENS_FILE, 'w') as f: json.dump(tokens_new, f, indent=2)
        return print("✓ Successfully cleaned usersDB")
    print("Cancelled the action. Nothing was changed.")

def reset():
    """erases any non built-in rooms. does NOT delete tokens"""
    with open(ROOMS_FILE, "r") as f: rooms = json.load(f)
    with open(TOKENS_FILE, "r")as f: tokens = json.load(f)
    users = tokens["users"]

    rooms2 = {k:v for k,v in rooms.items() if v.get("builtin") == False}
    if not rooms2: return print("Nothing to delete.")
    print("these rooms will be deleted:")
    print("\t- "+"\n\t- ".join(rooms2[r]["alias"] for r in rooms2.keys()))

    users = {k:{_k:_v if _k != "rooms" else {_k:[i for i in _v if not i in rooms2.keys()]} for _k,_v in v.items()} for k,v in users.items()}
    tokens["users"] = users

    rooms = {k:v for k,v in rooms.items() if k not in rooms2}
    if not rooms: print("NO rooms will remain.")
    else:
        print("these rooms will be remain:")
        print("\t- "+"\n\t- ".join(rooms[r]["alias"] for r in rooms.keys()))

    if not input("if you really wish to continue, press [Enter]"):
        with open(ROOMS_FILE, "w") as f: json.dump(rooms, f, indent=2)
        with open(TOKENS_FILE,"w") as f: json.dump(tokens, f, indent=2)
        return print("✓ Successfully deleted", len(rooms2), "rooms")
    print("Cancelled the action. Nothing was changed.")

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage:\npython tkmgr.py")
        print("\tadd <...>                        # Creates a new token")
        print("\t\t<client-name>                  # with a name pre-set")
        print("\t\t<client-name> <token>          # with a specified token")
        print("\t\t<client-name> <token> <[room]> # as a member in specific rooms")
        print("\t\t<...> admin (anywhere)         # You will be the Sigma")
        print("\tlist                             # List all authorized clients")
        print("\tsync                             # syncs rooms DB to users DB")
        print("\tclean                            # cleans the database.json")
        print("\treset                            # resets rooms to factory defaults")
        sys.exit(1)

    action = sys.argv[1]

    if action == "sync":
        sync_databases()

    elif action == "clean":
        clean_databases()

    elif action == "add":
        if len(sys.argv) < 3:
            print("Error: client name required")
            sys.exit(1)

        admin=False
        if "admin" in sys.argv:
            sys.argv.pop(sys.argv.index("admin"))
            admin=True

        client_name = sys.argv[2]
        token = sys.argv[3] if len(sys.argv) > 3 else None
        rooms = json.loads(sys.argv[4]) if len(sys.argv) > 4 else [0]
        
        if rooms is None:
            print("invalid JSON format for rooms! got:", rooms)
            sys.exit(1)

        token = add_client_token(client_name, token, rooms, admin)
        rooms_str = ", ".join(str(i) for i in rooms) if rooms else "None"
        
        print(f"""
  Added client: {client_name}
  Token: {token}
  Rooms: {rooms_str}
Share this token with the client via a secure channel.
        """)

    elif action == "list":
        clients = list_clients()
        if not clients:
            print("No authorized clients configured.")
        else:
            print("Authorized clients:")
            for token, info in clients.items():
                print(f"  - {info.get('name')} (Rooms: {info.get('rooms')})")

    elif action == "reset":
        print("This will reset the server to its default configuration, erasing all user data.")
        if input("Are you sure? Y/n: ") == "Y":
            reset()

    else:
        print(f"Unknown action: {action}")
        sys.exit(1)