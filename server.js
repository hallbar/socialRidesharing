var path = require('path');
var express = require('express');

var app = express();
var handlebars = require('express-handlebars').create({ defaultLayout:'main' });
var bodyParser = require('body-parser');
var session = require('express-session');
var mysql = require('mysql');
var pool = mysql.createPool({
    host: 'localhost',
    user: 'hallbar',
    password: '',
    database: 'c9'
});

process.env.PORT = 8081;

// Add session support (read/write to session with req.session)
app.use(session({secret: 'SuperSecretPassword', resave: false, saveUninitialized: false}));

// Allow for parsing JSON or URL encoded POST request bodies
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Set default view engine to Handlebars
app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');

// Statically serve all files in client directory
app.use('/static', express.static('client'));

app.get('/', function(req, res) {
   res.render('home', {
       title: 'Social Ridesharing'
   });
});

app.get('/driverSignUp', function(req, res) {
    res.render('signUp', {
        title: 'Driver Sign Up',
        role: 'Driver'
    });
});

app.post('/driverSignUp', function(req, res, next) {
    if(req.body.FirstName.length > 0 && req.body.LastName.length > 0 && req.body.PhoneNumber.length > 0) {
        pool.query("INSERT INTO `people` (`fname`, `lname`, `phone`, `driver`) VALUES (?, ?, ?, ?)", 
            [req.body.FirstName, req.body.LastName, req.body.PhoneNumber, 1], function(err, result) {
            if(err) {
                res.send('Database query was not successful' + err);
                next(err);
            }
            res.render('signupsuccess', {
                title: 'Sign Up Successful'
            });
        });
    }
});

app.get('/riderSignUp', function(req, res) {
    res.render('signUp', {
        title: 'Rider Sign Up',
        role: 'Rider'
    });
});

app.post('/riderSignUp', function(req, res, next) {
    if(req.body.FirstName.length > 0 && req.body.LastName.length > 0 && req.body.PhoneNumber.length > 0) {
        pool.query("INSERT INTO `people` (`fname`, `lname`, `phone`, `driver`) VALUES (?, ?, ?, ?)", 
            [req.body.FirstName, req.body.LastName, req.body.PhoneNumber, 0], function(err, result) {
            if(err) {
                res.send('Database query was not successful' + err);
                next(err);
            }
            res.render('signupsuccess', {
                title: 'Sign Up Successful'
            });
        });
    }
});

app.get('/riderOffer', function(req, res) {
    res.render('offer', {
        title: 'Ride Request',
        tableTitle: 'Ride Request'
    });
});

app.post('/riderOffer', function(req, res) {
   if(req.body) {
        pool.query("SELECT pid FROM `people` WHERE phone=" + req.body.phoneNumber, function(err, result) {
            if(err || result.length === 0) {
                console.log("not found");
                res.send("Phone number not registered. Please register before submitting an offer.");
                return;
            }
            console.log('inserting into trips');
            
            var fields = ['startZip', 'endZip', 'sun', 'mon', 'tue', 'wed', 'thur', 'fri', 'sat', 'startTime', 'endTime', 'cap', 'numPeople', 'pid'];
            var defaults = [undefined, undefined, 0, 0, 0, 0, 0, 0, 0, undefined, undefined, 0, 1, result[0].pid];
            var values = [];
            var query = [];
            query.push("INSERT INTO `trips` ");
            query.push("(");
            for(var f in fields) {
                query.push("`" + fields[f] + "`");
                if(f != fields.length - 1)
                    query.push(", ");
                    
                var value = req.body[fields[f]] || defaults[f];
                if(value === undefined) {
                    throw "Value " + fields[f] + " was not defined!";
                }
                values.push(value);
            }
            // values.push(result[0].pid);
            query.push(") VALUES (");
            for(var f in fields) {
                query.push("?");
                if(f != fields.length - 1)
                    query.push(", ");
            }
            query.push(")");
            
            //console.log(query.join(""));
            //console.log(values);
            
            var pid = result[0].pid;
            
            pool.query(query.join(""), values, function(err, result) {
                res.send('Offer posted successfully');
                
                // need to match and insert into people trips
            });
        });
    } 
});

app.get('/driverOffer', function(req, res) {
    res.render('offer', {
        title: 'Ride Offer',
        tableTitle: 'Ride Offer',
        driver: true
    });
});

app.post('/driverOffer', function(req, res, next) {
    if(req.body) {
        // var values = [req.body.startZip, req.body.endZip, req.body.sun, req.body.mon, req.body.tue, req.body.wed, req.body.thur,
        // req.body.fri, req.body.sat, req.body.startTime, req.body.endTime]
        // pool.query("INSERT INTO `trips` (`startZip`, `endZip`, `sun`, `mon`, `tue`, `wed`, `thur`, `fri`, `sat`, `startTime`, `endTime`, `cap`) VALUES "
        // + "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?", values, function);
        pool.query("SELECT pid FROM `people` WHERE phone=" + req.body.phoneNumber, function(err, result) {
            if(err || result.length === 0) {
                console.log("not found");
                res.send("Phone number not registered. Please register before submitting an offer.");
                return;
            }
            
            console.log('inserting into trips');
            
            var fields = ['startZip', 'endZip', 'sun', 'mon', 'tue', 'wed', 'thur', 'fri', 'sat', 'startTime', 'endTime', 'cap', 'numPeople', 'pid'];
            var defaults = [undefined, undefined, 0, 0, 0, 0, 0, 0, 0, undefined, undefined, undefined, 1, result[0].pid];
            var values = [];
            var query = [];
            query.push("INSERT INTO `trips` ");
            query.push("(");
            for(var f in fields) {
                query.push("`" + fields[f] + "`");
                if(f != fields.length - 1)
                    query.push(", ");
                    
                var value = req.body[fields[f]] || defaults[f];
                if(value === undefined) {
                    throw "Value " + fields[f] + " was not defined!";
                }
                values.push(value);
            }
            query.push(") VALUES (");
            for(var f in fields) {
                query.push("?");
                if(f != fields.length - 1)
                    query.push(", ");
            }
            query.push(")");
            
            //console.log(query.join(""));
            //console.log(values);
            
            var pid = result[0].pid;
            
            pool.query(query.join(""), values, function(err, result) {
                if(err) {
                    res.send('`trips` query was not successful' + err);
                    next(err);
                }
                res.send('Offer posted successfully');
                
                var tid = result.insertId;
                pool.query("INSERT INTO `people_trips` (pid, tid, driverId) VALUES (?, ?, ?)", [pid, tid, pid], function(err, result) {
                    if(err) {
                        res.send('`people_trips` query was not successful' + err);
                        next(err);
                    }
                    res.send('Offer posted successfully!');
                });
            });
        });
    }
    
});

app.use(function(err, req, res, next) {
	console.error(err.stack);
	res.type('plain/text');
	res.status(500);
	res.render('500 - ' + err);
});


app.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function() {
  console.log("Server listening");
});