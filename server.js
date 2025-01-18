const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fsExtra = require('fs-extra');
const mime = require('mime-types'); // Use this to detect MIME type based on file extension

var expressSession = require("express-parser");
var express = require("express")

var app = express();
var http = require("http").createServer(app);

var mongodb = require("mongodb");
var mongoClient = mongodb.MongoClient;
var ObjectId = mongodb.ObjectId;
var bodyParser = require("body-parser");
var bcrypt = require("bcrypt");
var formidable = require("formidable");
var fileSystem = require("fs");
var { getVideoDurationInSeconds } = require("get-video-duration");

var expressSession = require("express-session");

// Directories for videos and thumbnails
const videoDir = path.join(__dirname, 'public', 'videos');
const thumbnailDir = path.join(__dirname, 'public', 'thumbnails');

app.use(expressSession({
    "key": "user_id",
    "secret": "user secret Object Id",
    "resave": true,
    "saveUninitialized": true
}));
app.use("/public", express.static(__dirname + "/public"));

// a function to return user's document
async function getUser(database, id) {
    try {
        const user = await database.collection("users").findOne({
            "_id": new ObjectId(id)
        });
        return user;
    } catch (error) {
        throw error; // Or handle error as needed
    }
}

app.use(bodyParser.json({
    limit: "10000mb"
}));
app.use(bodyParser.urlencoded({
    extended: true,
    limit: "10000mb",
    parameterLimit: 1000000
}));

app.use("/public", express.static(__dirname + "/public"));
app.set("view engine", "ejs");

(async function initializeServer() {
    try {
        const client = await mongoClient.connect("mongodb://127.0.0.1:27017", { useUnifiedTopology: true });
        const database = client.db("my_video_streaming");

        console.log("Database connected.");
	// List all videos available
        app.get('/', async (req, res) => {
    try {
        const videos = await database.collection('videos').find().toArray();
        
        // Map videos to include the streaming URL
        const videoData = videos.map(video => ({
            ...video,
            videoUrl: `/video/${video._id}`  // Dynamic URL for video streaming
        }));

        res.render('index', {
            "islogin": req.session.user_id ? true : false,
            "videos": videoData // Pass the video data to the EJS template
        });
    } catch (error) {
        console.error('Error fetching videos:', error);
        res.status(500).send('Error fetching videos');
    }
});
        
        // Route to display video details
app.get('/video/:id', async (req, res) => {
    try {
    	// Check if user is logged in
        if (!req.session.user_id) {
            return res.redirect("/login");
        }
        const videoId = req.params.id;
        
        // Fetch the video by its ID
        const video = await database.collection("videos").findOne({ "_id": new ObjectId(videoId) });
        
        if (!video) {
            return res.status(404).send('Video not found');
        }

        // Fetch all other videos (exclude the current video)
        const otherVideos = await database.collection("videos").find({ "_id": { $ne: new ObjectId(videoId) } }).toArray();
	try {
    await database.collection('videos').updateOne(
      { _id: new ObjectId(videoId) },
      { $inc: { views: 1 } }
    );
    }catch (error) {
  // Error handling goes here
  console.error(error);
}
        // Render the video detail page and pass the video and other videos
        res.render('videoDetail', { "islogin": req.session.user_id ? true : false,
        			    video, videos: otherVideos });
    } catch (error) {
        console.error("Error fetching video:", error);
        res.status(500).send('Error fetching video');
    }
});


        app.get("/signup", function (req, res) {
            res.render("Signup");
        });

        app.get("/login", function (req, res) {
            res.render("login", {
                "message": "",
                "error": ""
            }
            );
        });


        app.post("/login", async function (req, res) {
            const user = await database.collection("users").findOne({
                email: req.body.email
            });

            if (user == null) {
                res.send("email not found");
            }
            else {
                bcrypt.compare(req.body.password, user.password, function (error, isVerify) {
                    if (isVerify) {
                        req.session.user_id = user._id;
                        res.redirect("/");
                    }
                    else {
                        res.send("Password incorrect");
                    }
                });
            }
        })

        app.post("/signup", async function (req, res) {
            try {
                const user = await database.collection("users").findOne({
                    email: req.body.email
                });

                if (user) {
                    // Email already exists
                    res.send("Email already exists");
                } else {
                    // Hash the password and insert new user
                    const hashedPassword = await bcrypt.hash(req.body.password, 10);
                    await database.collection("users").insertOne({
                        name: req.body.name,
                        email: req.body.email,
                        password: hashedPassword,
                        coverPhoto: "",
                        image: "",
                        subscribers: 0,
                        subscriptions: [],
                        playlists: [],
                        videos: [],
                        history: [],
                        notifications: []
                    });

                    res.redirect("/login");
                }
            } catch (error) {
                console.error(error);
                res.status(500).send("Internal Server Error");
            }
        });

	app.get("/logout", function (req, res) {
            if (req.session.user_id) {
            	req.session.user_id = false;
            	res.redirect("/");
            }
            
        });

        app.get("/upload", function (req, res) {
            if (req.session.user_id) {
                //create new page for upload
                res.render("upload", {
                    "islogin": true
                });
            } else {
                res.redirect("/login");
            }
        });

        app.post("/Upload-video", async function (req, res) {
            try {
                // Check if user is logged in
                if (!req.session.user_id) {
                    return res.redirect("/login");
                }

                const formData = new formidable.IncomingForm();
                formData.maxFileSize = 1000 * 1024 * 1024; // 1GB limit

                // Parse the form data
                const { fields, files } = await new Promise((resolve, reject) => {
                    formData.parse(req, (error, fields, files) => {
                        if (error) {
                            return reject(error);
                        }
                        resolve({ fields, files });
                    });
                });

                // Extract form data and file paths
                const title = fields.title;
                const description = fields.description;
                const tags = fields.tags;
                const category = fields.category;

                const oldPathThumbnail = files.thumbnail[0].filepath;
                const thumbnail =
                    "public/thumbnails/" + new Date().getTime() + "-" + files.thumbnail[0].newFilename;

                const oldPathVideo = files.video[0].filepath;
                const newPath =
                    "public/videos/" + new Date().getTime() + "-" + files.video[0].newFilename;

                console.log("Old Video Path:", oldPathVideo);
                console.log("New Video Path:", newPath);

                // Copy the video file
                await new Promise((resolve, reject) => {
                    fileSystem.copyFile(oldPathVideo, newPath, (error) => {
                        if (error) {
                            return reject(error);
                        }
                        // Delete the original file
                        fileSystem.unlink(oldPathVideo, (unlinkError) => {
                            if (unlinkError) {
                                return reject(unlinkError);
                            }
                            resolve();
                        });
                    });
                });

                // Copy the thumbnail file
                await new Promise((resolve, reject) => {
                    fileSystem.copyFile(oldPathThumbnail, thumbnail, (error) => {
                        if (error) {
                            return reject(error);
                        }
                        // Delete the original file
                        fileSystem.unlink(oldPathThumbnail, (unlinkError) => {
                            if (unlinkError) {
                                return reject(unlinkError);
                            }
                            resolve();
                        });
                    });
                });

                var user;

                try {
                    // Get user data
                    user = await getUser(database, req.session.user_id);

                    console.log("getting user");
                    if (!user) {
                        throw new Error("User not found");
                    }

                    // Use the user object here
                } catch (error) {
                    console.error(error.message);
                    // Handle the error, e.g., send a response with an error message
                }


                const currentTime = new Date().getTime();

                // Get video duration
                const duration = await getVideoDurationInSeconds(newPath);
                const hours = Math.floor(duration / 60 / 60);
                const minutes = Math.floor(duration / 60) - hours * 60;
                const seconds = Math.floor(duration % 60);

                // Insert video into the database
                const videoData = {
                    user: {
                        _id: user._id,
                        name: user.name,
                        image: user.image,
                        subscribers: user.subscribers,
                    },
                    filePath: newPath,
                    thumbnail: thumbnail,
                    title: title,
                    description: description,
                    tags: tags,
                    category: category,
                    createdAt: currentTime,
                    hours: hours,
                    minutes: minutes,
                    seconds: seconds,
                    watch: currentTime,
                    views: 0,
                    playlist: "",
                    likers: [],
                    dislikers: [],
                    comments: [],
                };

                console.log(videoData);
                const insertedVideo = await database.collection("videos").insertOne(videoData);

                // Update the user's video list
                await database.collection("users").updateOne(
                    { _id: new ObjectId(req.session.user_id) },
                    {
                        $push: {
                            videos: {
                                _id: insertedVideo.insertedId,
                                title: title,
                                views: 0,
                                thumbnail: thumbnail,
                                watch: currentTime,
                            },
                        },
                    }
                );

                // Redirect to home
                res.redirect("/");
            } catch (error) {
                console.error("Error in /Upload-video route:", error);
                res.status(500).send("An error occurred during video upload");
            }
        });

// Like Video
app.post('/video/:id/like', async (req, res) => {
    const videoId = req.params.id;
        
    // Fetch the video by its ID
    const video = await database.collection("videos").findOne({ "_id": new ObjectId(videoId) });
    console.log(videoId)
    console.log(video)
    if (!video.likers.includes(req.session.user_id)) {
    try {
    await database.collection('videos').updateOne(
      { _id: new ObjectId(videoId) },
      { $push: { likers: req.session.user_id } }
    )
    }catch (error) {
      console.log("Error:", error);
    }
    }
    res.json({ likes: video.likers.length });
});

// Dislike Video
app.post('/video/:id/dislike', async (req, res) => {
    const videoId = req.params.id;
        
    // Fetch the video by its ID
    const video = await database.collection("videos").findOne({ "_id": new ObjectId(videoId) });
    if (!video.dislikers.includes(req.session.user_id)) {
    try {
    await database.collection('videos').updateOne(
      { _id: new ObjectId(videoId) },
      { $push: { dislikers: req.session.user_id } }
    )
    }catch (error) {
      console.log("Error:", error);
    }
    }
    res.json({ dislikes: video.dislikers.length });
});

// Add Comment
app.post('/video/:id/comment', async (req, res) => {
    const videoId = req.params.id;
        
    // Fetch the video by its ID
    const video = await database.collection("videos").findOne({ "_id": new ObjectId(videoId) });
    user = await database.collection("users").findOne({ "_id": new ObjectId(req.session.user_id) });
    console.log(req.session);
    const comment = { user: user.name, text: req.body.text,createdAt: Date.now() };

  try {
    await database.collection('videos').updateOne(
      { _id: new ObjectId(videoId) },
      { $push: { comments: comment } }
    )
    //res.redirect(`/video/${videoId}`);
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).send('Internal Server Error');
  }
    res.json(comment);
});


        // Start the HTTP server
        http.listen(3000, function () {
            console.log("Server started on port 3000.");

        });

    } catch (error) {
        console.error("Failed to connect to the database:", error);
    }
})();
