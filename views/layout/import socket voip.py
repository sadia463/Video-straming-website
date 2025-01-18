import socket
import pyaudio
import threading
from tkinter import *

# Audio Configuration
CHUNK = 1024
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 44100

# Client Configuration
server_address = input("Enter server IP address: ")
username = input("Enter your username: ")

# Audio Initialization
p = pyaudio.PyAudio()
stream = p.open(format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                output=True,
                frames_per_buffer=CHUNK)

# Socket Initialization
client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
client_socket.connect((server_address, 12345))
client_socket.sendall(f"REGISTER {username}".encode())

# GUI
class VoIPApp(Frame):
    def _init_(self, master=None):
        Frame._init_(self, master)
        self.master = master
        self.pack()
        self.call_active = False
        self.create_widgets()

    def create_widgets(self):
        self.status_label = Label(self, text="Logged in as " + username)
        self.status_label.pack(pady=10)

        self.call_button = Button(self, text="Call User", command=self.call_user)
        self.call_button.pack(pady=10)

        self.end_call_button = Button(self, text="End Call", command=self.end_call, state=DISABLED)
        self.end_call_button.pack(pady=10)

    def call_user(self):
        target_username = input("Enter username to call: ")
        client_socket.sendall(f"CALL {target_username}".encode())
        self.status_label["text"] = f"Calling {target_username}..."

    def end_call(self):
        self.call_active = False
        self.end_call_button["state"] = DISABLED
        self.call_button["state"] = NORMAL
        self.status_label["text"] = "Call ended."

    def handle_audio(self, target_ip):
        self.call_active = True
        self.end_call_button["state"] = NORMAL
        self.call_button["state"] = DISABLED
        self.status_label["text"] = f"Connected to {target_ip}."

        # Start audio stream
        target_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        target_socket.connect((target_ip, 1234))

        def send_audio():
            while self.call_active:
                data = stream.read(CHUNK)
                target_socket.sendall(data)

        def receive_audio():
            while self.call_active:
                data = target_socket.recv(CHUNK)
                if data:
                    stream.write(data)

        threading.Thread(target=send_audio).start()
        threading.Thread(target=receive_audio).start()

def listen_for_call_requests(app):
    while True:
        message = client_socket.recv(1024).decode()
        if message.startswith("CALL_REQUEST"):
            target_ip = message.split()[1]
            response = input(f"Incoming call from {target_ip}. Accept? (y/n): ")
            if response.lower() == "y":
                app.handle_audio(target_ip)

root = Tk()
root.title("VoIP System")
app = VoIPApp(master=root)

# Start listening for incoming calls
threading.Thread(target=listen_for_call_requests, args=(app,)).start()

root.mainloop()

client_socket.close()
stream.close()
p.terminate()