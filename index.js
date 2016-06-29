
	"use strict";

	const request 	= require("request");
	const express 	= require("express");
	const ws 		= require("ws");
	const url 		= require("url");
	const http 		= require("http");
	const zlib 		= require("zlib");
	const dgram 	= require("dgram");

	const app 			= express();
	const httpServer 	= http.createServer(app);
	const udpServer		= dgram.createSocket("udp4");
	const wsServer 		= new ws.Server({ server: httpServer });

	const httpPort 		= 4080;
	const udpPort 		= 12201;

	const charToWs 		= {};
	const udpToChars 	= {};
	const crestTokenMsg = "Setting CrestConnection Token as ";

	wsServer.on("connection", ws => {
		ws.json = data => ws.send(JSON.stringify(data));
		let location = url.parse(ws.upgradeReq.url, true);
		// you might use location.query.access_token to authenticate or share sessions 
		// or ws.upgradeReq.headers.cookie (see http://stackoverflow.com/a/16395220/151312) 

		ws.on("message", message => {
			console.log('received: %s', message);
			try {
				let data = JSON.parse(message);

				switch (data.type) {
					case "auth": 
						return wsAuth(ws, data);
				}
			} catch (e) {
				console.log(e);
			}
		});

		ws.send('something');
	});

	app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));

	app.get("/implicit", (req, res) => res.sendFile(__dirname + "/callback.html"));

	httpServer.listen(httpPort);

	udpServer.on("error", (err) => {
		console.log(`server error:\n${err.stack}`);
		udpServer.close();
	});

	udpServer.on("message", (msg, rinfo) => {
		//console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
		zlib.inflate(msg, (err, buffer) => {
			if(err) {
				console.log(err);
			} else {
				try {
					let data = JSON.parse(buffer.toString());
						data.short_message = data.short_message.replace(/(\0)+$/, "");
					//console.log(JSON.stringify(data));
					if(data.full_message.indexOf(crestTokenMsg) === 0) {
						var token = data.full_message.slice(crestTokenMsg.length);
						getCharList(token, (err, list) => {
							if(list) {
								udpToChars[[rinfo.address, rinfo.port, data.version, data._pid, data.host].join("-")] = list;
							}
						});
					}
					(udpToChars[[rinfo.address, rinfo.port, data.version, data._pid, data.host].join("-")] || []).map(id => charToWs[id] || []).map(wss => (wss || []).map(ws => ws.json(data)));
				} catch (e) {
					console.log(e);
				}
			}
		});
	});

	udpServer.on("listening", () => {
		let address = udpServer.address();
		console.log(`server listening ${address.address}:${address.port}`);
	});

	udpServer.bind(udpPort);


	// methods
	
	function wsAuth (ws, data) {
		if(!data.access_token) return;

		verifyToken(data.access_token, (err, data) => {
			console.log(err, data);
			if(!charToWs[data.CharacterID]) charToWs[data.CharacterID] = [];
			charToWs[data.CharacterID].push(ws);
		});
	}

	function verifyToken (token, cb) {
		request(
			{
				method: "GET",
				url: "https://login.eveonline.com/oauth/verify",
				headers: {
					"Authorization": `Bearer ${token}`
				}
			},
			(err, reqres, body) => {
				if(err) return cb(err);
				try {
					let res = JSON.parse(body);
					cb(null, res);
				} catch (e) {
					cb(e);
				}
			}
		).on("error", cb);
	}

	function getCharList (token, cb) {
		request(
			{
				method: "GET",
				url: "https://api.eveonline.com/Account/APIKeyInfo.xml.aspx?accessToken=" + token
			},
			(err, reqres, body) => {
				if(err) return cb(err);
				cb(null, body.match(/characterID="([0-9]*)"/g).map(str => parseInt(str.slice(13, -1), 10)));
			}
		).on("error", cb);
	}