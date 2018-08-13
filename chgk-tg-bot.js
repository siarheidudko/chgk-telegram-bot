/* ALL */

const VERSION = '0.0.1';

const https=require("https"), 
http=require("http"),
url=require("url"),
os=require("os"),
redux=require("redux"),
lodash=require("lodash"),
fs=require("fs"),
xml2js = require('xml-parser'),
stream = require('stream'),
zlib = require('zlib'),
cryptojs=require("cryptojs"),
nodemailer = require('nodemailer');

//конфиг
var global = {};
//флаг синхронизации
var SyncDatabaseTimeout = false;

//инициализируем хранилище Redux
var ProcessStorage = redux.createStore(editProcessStorage);

//точка входа
getSettings().then(function(value){ if(value === 'ok'){
	var _question = ProcessStorage.getState().question.question;
	ProcessStorage.subscribe(function(){	//при обновлении хранилища - отправляем новые данные в воркеры
		if(!SyncDatabaseTimeout){ //проверяем что флаг ожидания синхронизации еще не установлен 
			SyncDatabaseTimeout = true; //установим флаг, что в хранилище есть данные ожидающие синхронизации
			setTimeout(setDatabase,15000); //синхронизируем хранилище через минуту (т.е. запрос не будет чаще, чем раз в минуту)
		}
		if(!(lodash.isEqual(_question, ProcessStorage.getState().question.question)) && (typeof(ProcessStorage.getState().question.question) !== 'undefined')){
			for(const chat in ProcessStorage.getState().chats){
				outgoingMsg(chat, 'Внимание, новый вопрос:\n'+ProcessStorage.getState().question.question);
			}
			_question = ProcessStorage.getState().question.question;
			console.log(ProcessStorage.getState().question);
		}
	});
	getDatabase().then(function(value){ 
		if(value !== 'error'){
			ProcessStorage.dispatch({type:'SYNC_DB', payload: value});
		}
		startMasterHandler();
	}).catch(function(error){
		SendLogger('' + error);
	});
}}).catch(function(error){
	SendLogger('' + error);
});

//функция чтения файла конфигурации, имя файла конфигурации = имени скрипта (чистая)
function getSettings(){
	return new Promise(function (resolve, reject){
		try {
			fs.readFile(__filename.replace(".js",".conf"), "utf8", function(error,data){
				try {	
					if(error) {
						throw error; 
					} else {
						const _global = JSON.parse(data);
						for(const key in _global){
							global[key] = _global[key];
						}
						resolve('ok');
					}
				} catch(e){
					SendLogger('Ошибка чтения файла конфигурации' + e);
					resolve('error');
				}
			});
		} catch (e) {
			SendLogger('Ошибка чтения файла конфигурации' + e);
			resolve('error');
		}
	});
}

//функция работы с хранилищем redux
function editProcessStorage(state = {questions:[], question:{}, chats:{}}, action){
	try {
		switch (action.type){
			case 'SYNC_DB':
				var state_new = lodash.clone(state);
				for(const key in action.payload){
					state_new[key] = (lodash.clone(action.payload[key]));
				}
				return state_new;
				break;
			case 'ADD_QUESTIONS':	//добавление новых вопросов
				var state_new = lodash.clone(state);
				for(const key in action.payload){
					state_new.questions.push(lodash.clone(action.payload[key]));
				}
				return state_new;
				break;
			case 'ADD_ONE_QUESTION':
				var state_new = lodash.clone(state);
				if(state_new.questions.length > 0){
					const _id = parseInt(Math.random() * state_new.questions.length); 
					state_new.question = lodash.clone(state_new.questions[_id]);
					state_new.question['time'] = Date.now();
					var _t1 = state_new.question.answer.toLowerCase();
					const _t2 = _t1.indexOf('(');
					const _t3 = _t1.indexOf(')');
					if (_t2 !== -1){
						const _t4 = _t3 - _t2;
						if(_t4 > 0){
							_t1 = _t1.replace(_t1.substr(_t2,_t4),"");
						}
					}
					const _temp = _t1.match(/[\wа-яё]+/ig);
					state_new.question['md5'] = [];
					for(const key in _temp){
						state_new.question['md5'].push(cryptojs.Crypto.MD5(JSON.stringify(_temp[key])));
					}
					state_new.questions.splice(_id,1);
				}
				for(const chat in state_new.chats){
					if((Date.now() - 1800000) > state_new.chats[chat]){
						delete state_new.chats[chat];
					}
				}
				return state_new;
				break;
			case 'ADD_CHAT':
				var state_new = lodash.clone(state);
				state_new.chats[action.payload] = Date.now();
				return state_new;
				break;
			case 'ANSWERED_ONE_QUESTION':
				var state_new = lodash.clone(state);
				state_new.question = {};
				return state_new;
				break;
			default:
				break;
		}
	} catch(e){
		SendLogger("Ошибка при обновлении хранилища(мастер):" + e);
	}
	return state;
}

//функция записи в базу данных
function setDatabase(){
	try {
		var resultFs = fs.writeFileSync(__filename.replace(".js",".db"), JSON.stringify(ProcessStorage.getState()), (err) => {
			try{
				if (err) throw err;
			} catch(e){
				SendLogger("Проблема записи в базу данных!");
				setTimeout(setDatabase,15000); //при ошибке запустим саму себя через минуту
				return;
			}
		});
		if(typeof(resultFs) === 'undefined'){
			SyncDatabaseTimeout = false; //вернем начальное состояние флагу синхронизации
			console.log("Синхронизация с базой данных выполнена!");
			return;
		};
	} catch (e) {
		SendLogger("База данных недоступна!");
		setTimeout(setDatabase,15000); //при ошибке запустим саму себя через минуту
		return;
	}
}

//функция чтения базы данных
function getDatabase(){
	return new Promise(function (resolve){
		try {
			fs.readFile(__filename.replace(".js",".db"), "utf8", function(error,data){
				try {	
					if(error) {
						throw error;
					} else {
						resolve(JSON.parse(data));
					}
				} catch(e){
					SendLogger(datetime() + "База данных испорчена!");
					resolve('error');
				}
			});
		} catch (e) {
			SendLogger(datetime() + "База данных недоступна!");
			resolve('error');
		}
	});
}

//функция для таймштампа (чистая)
function datetime() {
	try {
		var dataObject = new Date;
		var resultString;
		if(dataObject.getDate() > 9){
			resultString = dataObject.getDate() + '.';
		} else {
			resultString = '0' + dataObject.getDate() + '.';
		}
		if((dataObject.getMonth()+1) > 9){
			resultString = resultString + (dataObject.getMonth()+1) + '.' + dataObject.getFullYear() + ' ';
		} else {
			resultString = resultString + '0' + (dataObject.getMonth()+1) + '.' + dataObject.getFullYear() + ' ';
		}
		if(dataObject.getHours() > 9){
			resultString = resultString + dataObject.getHours() + ':';
		} else {
			resultString = resultString + '0' + dataObject.getHours() + ':';
		}
		if(dataObject.getMinutes() > 9){
			resultString = resultString + dataObject.getMinutes() + ':';
		} else {
			resultString = resultString + '0' + dataObject.getMinutes() + ':';
		}
		if(dataObject.getSeconds() > 9){
			resultString = resultString + dataObject.getSeconds();
		} else {
			resultString = resultString + '0' + dataObject.getSeconds();
		}
		return resultString + " | ";
	} catch(e){
		return '00.00.0000 00:00:00 | ';
	}
}

//функция отправки сообщений на почту (чистая)
function SendLogger(data){
	const _data = ''+data;
	console.log(datetime() + _data);
	function SendEmail(_data_){
		var _secure = false;
		if(global['email-port'] === 465){
			_secure = true;
		}
		nodemailer.createTestAccount((err, account) => {
			// create reusable transporter object using the default SMTP transport
			let transporter = nodemailer.createTransport({
				host: global['email-host'],
				port: global['email-port'],
				secure: _secure, // true for 465, false for other ports
				auth: {
					user: global['email-email'], // generated ethereal user
					pass: global['email-pswd'] // generated ethereal password
				}
			});

			// setup email data with unicode symbols
			let mailOptions = {
				from: '"Бот Что? Где? Когда?" <'+global['email-email']+'>', // sender address
				to: global['email-to'], // list of receivers (через запятую)
				subject: _data_.substr(0, 10), // Subject line
				text: _data_, // plain text body
				html: _data_ // html body
			};

			// send mail with defined transport object
			transporter.sendMail(mailOptions, (error, info) => {
				if (error) {
					return console.log(''+error);
				}
				console.log('Message sent: %s', info.messageId);
			});
		});
	}
	setTimeout(SendEmail, RandomGen(15000), _data); 
}

//функция генерации случайного целого с верхним пределом в data (чистая)
function RandomGen(data){
	try{
		if(data > 3000){
          var wid = 1000;
        } else {
          var wid = 0;
        }
		return parseInt(Math.random() * (data - wid) + wid);
	} catch(err){
		return 1000;
	}
}

//запрос к серверу (чистая)
function RestRequest(){
	return new Promise(function(resolve, reject){
		try{
			if (url.parse(global['chgk-url']).protocol === null) {	//определяем тип сервера и используемую библиотеку
				req = http;
			} else if (url.parse(global['chgk-url']).protocol === 'https:') {
				req = https;
			} else {
				req = http;
			}
			var getoptions = url.parse(global['chgk-url']);	//создаем параметры запроса 
			getoptions.method = 'GET';
			getoptions.headers = {};
			getoptions.headers["User-Agent"] = "CHGK-TG-BOT";
			getoptions.headers["Keep-Alive"] = "120";
			getoptions.headers["Accept-Charset"] = 'utf-8';
			getoptions.headers["Host"] = url.parse(global['chgk-url']).hostname;
			var this_request = req.request(getoptions, (response) => {
				var postdata = [];	//массив буфферов результата запроса
				const gunzipper = zlib.createGunzip();	//поток декомпрессии
				const Writable = stream.Writable();	//поток чтения
				Writable._write = function (chunk, enc, next) {	//обработка потока
					postdata.push(chunk);	//пушим буффер в массив
					next();
				};
				function closerErrStream(data){
					response.unpipe(Writable); //отвязываем потоки	
					response.destroy(); //уничтожаем потоки
					gunzipper.close();
					Writable.destroy();
					if(data){
						SendLogger('Ошибка обработки потоков: ' + data);
						resolve('error');
					}
				}
				gunzipper.on("error", function(err){ //обработка ошибок потоков
					closerErrStream(err);
				});
				Writable.on("error", function(err){ 
					closerErrStream(err);
				});
				response.on("error", function(err){ 
					closerErrStream(err);
				});
				Writable.on('finish', () => { 
					response.unpipe(); //отвязываем потоки
					response.destroy();	//уничтожаем потоки
					gunzipper.close();
					try{
						resolve(xml2js((Buffer.concat(postdata)).toString('utf8')));
					} catch(err){
						resolve('error');
					}
				});
				switch(response.statusCode){
					case 200:
						if(response.headers['content-encoding'] === 'gzip'){
							response.pipe(gunzipper).pipe(Writable);
						} else {
							response.pipe(Writable);
						}
						break; 
					default:
						resolve('error');
						SendLogger('ANSWER:' + response.statusCode + ' | ' + response.statusMessage);
						closerErrStream();
						break;
				}
			}); 
			if((typeof(dataClear) === 'string') && (dataClear !== '')){
				this_request.write(dataClear);	//отправка post-данных
			}
			this_request.on('error', function (e) {	//обработка ошибок
				SendLogger('Ошибка rest-запроса:'+e);
				resolve('error');
			});
			this_request.on('timeout', function () {	//обработка таймаута
				this_request.abort();
				SendLogger('Таймаут rest-запроса!');
				resolve('error');
			});
			this_request.setTimeout(60000);	//таймаут соединения
			this_request.end();
		} catch(err){
			SendLogger('Ошибка rest-запроса (глобальная обертка):'+err);
			resolve('error');
		}
	});
}

function NormaliseObject(data){
	const _data = lodash.clone(data);
	var _result = [];
	try {
		for(const key0 in _data.root){
			if(typeof(_data.root[key0]) === 'object'){
				for(const key1 in _data.root[key0]){
					if(_data.root[key0][key1].name === 'question'){
						var _tmp = {};
						for(const key2 in _data.root[key0][key1].children){
							if(_data.root[key0][key1].children[key2].name === 'Question'){
								_tmp[_data.root[key0][key1].children[key2].name.toLowerCase()] =  _data.root[key0][key1].children[key2].content.replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,"").replace(/&amp;#1118;/gi,"/").replace(/pic: /gi,"https://pda.baza-voprosov.ru/images/db/");
							}
							if(_data.root[key0][key1].children[key2].name === 'QuestionId'){
								_tmp[_data.root[key0][key1].children[key2].name.toLowerCase()] =  _data.root[key0][key1].children[key2].content.replace(/&quot;/gi,"");
							}
							if(_data.root[key0][key1].children[key2].name === 'Answer'){
								_tmp[_data.root[key0][key1].children[key2].name.toLowerCase()] =  _data.root[key0][key1].children[key2].content.replace(/&quot;/gi,"");
							}
						}
						if((typeof(_tmp['question']) === 'string') && (typeof(_tmp['questionid']) === 'string') && (typeof(_tmp['answer']) === 'string')){
							_result.push(_tmp);
						}
					}
				}
			}
		}
	} catch(err){
		SendLogger('Ошибка преобразования объекта:' + err);
	}
	return _result;
}

function GetQuestions(){
	if(ProcessStorage.getState().questions.length < 1000){
		RestRequest().then(function(val){
			ProcessStorage.dispatch({type:'ADD_QUESTIONS', payload: NormaliseObject(val)});
		}).catch(function(error){
			SendLogger('Ошибка в ожидании RestRequest:' + error);
		});
	}
}

function AddQuestion(){
	if(typeof(ProcessStorage.getState().question['time']) === 'undefined'){
		ProcessStorage.dispatch({type:'ADD_ONE_QUESTION'});
	} else if ((ProcessStorage.getState().question['time'] + 600000) < Date.now()) {
		for(const chat in ProcessStorage.getState().chats){
			outgoingMsg(chat, 'Время истекло, правильный ответ:\n'+ProcessStorage.getState().question.answer);
		}
		setTimeout(function(){ProcessStorage.dispatch({type:'ADD_ONE_QUESTION'});}, 1000);
	}
}

function outgoingMsg(id, data, reply){
	var _silent = false;
	const _hour = (new Date).getHours();
	if((_hour < 8) || (_hour > 22)){
		_silent = true;
	}
	if(typeof(reply) === 'number'){
		var _msg = {chat_id:id, text:data, disable_notification:_silent, reply_to_message_id:reply};
	} else {
		var _msg = {chat_id:id, text:data, disable_notification:_silent};
	}
	var getoptions = url.parse('https://api.telegram.org/bot'+global['bot-key']+'/sendMessage');	//создаем параметры запроса 
	getoptions.method = 'POST';
	getoptions.headers = {};
	getoptions.headers["User-Agent"] = "CHGK-TG-BOT";
	getoptions.headers["Keep-Alive"] = "120";
	getoptions.headers["Accept-Charset"] = 'utf-8';
	getoptions.headers["Content-Type"] = 'application/json';
	var this_request = https.request(getoptions, (response) => {
		//console.log(''+response);
	});
	this_request.write(JSON.stringify(_msg));
	this_request.end();
}

function incommingMsg(data){
	if(typeof(data.message) === 'object'){
		const _data = lodash.clone(data.message);
		ProcessStorage.dispatch({type:'ADD_CHAT', payload: _data.chat.id});
		var answer = '';
		if(((typeof(_data.from.first_name) === 'string') && (_data.from.first_name !== '')) || ((typeof(_data.from.last_name) === 'string') && (_data.from.last_name !== ''))){
			answer = _data.from.first_name + ' ' + _data.from.last_name + '(' + _data.from.id + ')';
		} else if ((typeof(_data.from.username) === 'string') && (_data.from.username !== '')){
			answer = _data.from.username + '(' + _data.from.id + ')';
		} else {
			answer = _data.from.id;
		}
		const text = _data.text.toLowerCase().match(/[\wа-яё\/]+/ig);
		switch(text[0]){
			case '/quest':
				outgoingMsg(_data.chat.id, ProcessStorage.getState().question.question);
				break;
			case '/next':
				for(const chat in ProcessStorage.getState().chats){
					outgoingMsg(chat, 'Вопрос сброшен пользователем '+answer+', правильный ответ:\n'+ProcessStorage.getState().question.answer);
				}
				setTimeout(function(){ProcessStorage.dispatch({type:'ADD_ONE_QUESTION'});}, 1000);
				break;
			case '/start':
				outgoingMsg(_data.chat.id, 'Добро пожаловать в бота ЧГК. На повестке дня вопрос:\n'+ProcessStorage.getState().question.question);
				break;
			case '/chatid':
				outgoingMsg(_data.chat.id, _data.chat.id.toString());
				break;
			default:
				var rightanswer = false;
				var _temp = 0;
				for(const key in text){
					if(ProcessStorage.getState().question.md5.indexOf(cryptojs.Crypto.MD5(JSON.stringify(text[key]))) !== -1){
						_temp++;
					}
				}
				const _proc = _temp / ProcessStorage.getState().question.md5.length;
				if(_proc > 0.8){
					answer = answer + " - ответил верно!\nПравильный ответ:\n" + ProcessStorage.getState().question.answer;
					rightanswer = true;
				} else if(_temp !== 0) {
					answer = "Процент совпадения:"+parseInt(_proc*100);
				}
				if(rightanswer){
					for(const chat in ProcessStorage.getState().chats){
						outgoingMsg(chat, answer);
					}
					setTimeout(function(){ProcessStorage.dispatch({type:'ANSWERED_ONE_QUESTION'});}, 500);
				} else if(_temp !== 0) {
					outgoingMsg(_data.chat.id, answer, _data.message_id);
				}
				break;
		}
	} 
}

var registrationBot = function(socket){
	var getoptions = url.parse('https://api.telegram.org/bot'+global['bot-key']+'/setWebhook');	//создаем параметры запроса 
	getoptions.method = 'POST';
	getoptions.headers = {};
	getoptions.headers["User-Agent"] = "CHGK-TG-BOT";
	getoptions.headers["Keep-Alive"] = "120";
	getoptions.headers["Accept-Charset"] = 'utf-8';
	getoptions.headers["Content-Type"] = 'application/json';
	var this_request = https.request(getoptions, (response) => {
		var _getoptions = url.parse('https://api.telegram.org/bot'+global['bot-key']+'/getWebhookInfo');	//создаем параметры запроса 
		_getoptions.method = 'POST';
		var _this_request = https.request(_getoptions, (_response) => {
			socket.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
			_response.pipe(socket);
		});
		_this_request.end(); 
	});
	this_request.write(JSON.stringify({'url':global['wh-url']+':'+global['wh-port']+'/v1/wh-tg-bot', "max_connections":100}));
	this_request.end();
}

var webserverfunc = function(req, res){ 
	try {
		var req_url = url.parse(req.url);
		var params_url = new URLSearchParams(req_url.query);
		var logstring = req.connection.remoteAddress + " | " + req.method + " | " + req.url;
		console.log(logstring);  //пишем в лог запрос
		req.setEncoding('utf8'); //задаем принудительно utf-8
		switch(req.method){
			case 'POST':
				switch(req_url.pathname){
					case '/v1/wh-tg-bot':
						var rawData = '';
						req.on('data', (chunk) => { rawData += chunk; });	//получаем json из POST в rawData
						req.on('end', () => {
							try{
								res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
								res.end('OK');
								incommingMsg(JSON.parse(rawData.toString()));
							} catch(e){
								res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'});
								res.end('Bad Request');
							}
						});
						break;
					case '/v1/registration':
						registrationBot(res);
						break;
					default:
						res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
						res.end('Not Found');
						break;
				}
				break;
			default:
				res.writeHead(405, {'Content-Type': 'text/plain; charset=utf-8'});
				res.end('Method Not Allowed');
				break;
		}
	} catch(e){
		SendLogger('Ошибка обработки запроса: '+e)
		res.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
		res.end('Internal Server Error');
	}
}

function startWebHookServer(){
	if((typeof(global['cert-crt']) !== 'undefined') && (global['cert-crt'] !== '') && (typeof(global['cert-key']) !== 'undefined') && (global['cert-key'] !== '') && (typeof(global['cert-ca']) !== 'undefined') && (global['cert-ca'] !== '')) {
		var ssl = {
			key: fs.readFileSync(global['cert-key']),
			cert: fs.readFileSync(global['cert-crt']) + '\n' + fs.readFileSync(global['cert-ca'])
		};
	} else{
		var ssl = 'error';
	}
	if(ssl !== 'error'){ //в зависимости от ssl запускаем http или https сервер
		var server = https.createServer(ssl, webserverfunc).listen(global['wh-port'], '0.0.0.0');
		SendLogger('https-сервер запущен на порту:' + global['wh-port']);
	} else {
		var server = http.createServer(webserverfunc).listen(global['wh-port'], '0.0.0.0');
		SendLogger('http-сервер запущен на порту:' + global['wh-port']);
	}
	server.timeout = 300000; //таймаут запроса
}

function startMasterHandler(){
	GetQuestions(); setInterval(GetQuestions, 10000);
	AddQuestion(); setInterval(AddQuestion, 10000);
	startWebHookServer();
}
