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
       title: 'Social Ridesharing',
       authenticated: req.session.user ? true : false,
       name: req.session.user ? req.session.user.fname : undefined
   });
});

app.get('/login', function(req, res) {
    res.render('login');
});

app.post('/login', function(req, res) {
    var findUser = "SELECT * FROM people where phone=?";
    pool.query(findUser, [req.body.phone], function(err, result) {
        if(err) {
            res.render('login', {
                error: 'Database error. Please try again later.'
            });
        } else if(result === undefined || result.length === 0) {
            res.render('login', {
                error: "Sorry, we couldn't find a user with that phone number."
            });
        } else {
            req.session.user = { fname: result[0].fname, lname: result[0].lname, phone: result[0].phone };
            res.redirect('/');
        }
    });
});

app.get('/logout', function(req, res) {
    req.session.destroy();
    res.redirect('/');
})

app.get('/register', function(req, res) {
    res.render('register', {
        title: 'Registration'
    });
});

app.post('/register', function(req, res, next) {
    if(req.body.FirstName.length == 0 || req.body.LastName.length == 0 || req.body.PhoneNumber.length == 0) {
        res.render('register', {
            title: 'Registration',
            error: 'All fields are required!'
        });
        return;
    }
    
    pool.query("SELECT * FROM `people` WHERE phone=?", [req.body.PhoneNumber], function(err, result) {
        if(err) {
            res.render('register', {
                title: 'Registration',
                error: 'Database error when checking if account already exists.'
            });
            return;
        } else if(result !== undefined && result.length > 0) {
            res.render('register', {
                title: 'Registration',
                error: 'Someone has already made an account with that phone number!'
            });
            return;
        }
        
        pool.query("INSERT INTO `people` (`fname`, `lname`, `phone`) VALUES (?, ?, ?)", 
            [req.body.FirstName, req.body.LastName, req.body.PhoneNumber], function(err, result) {
            if(err) {
                res.render('register', {
                    title: 'Registration',
                    error: 'Database error when inserting new account.'
                });
                return;
            }
            res.redirect('/login');
        });
    });
        
});

app.get('/post-offer', checkAuth, function(req, res) {
    res.render('offer', {
        title: 'Ride Offer',
        tableTitle: 'Ride Offer'
    });
});

app.post('/post-offer', checkAuth, function(req, res, next) {
    if(req.body) {
        getPid(req, res, function(pid) {
            getTid(req, res, function(tid) {
                if(tid === undefined) {
                    addTrip(req, res, function() {
                        getTid(req, res, function(tid) {
                            addPeopleTripAssociation(req, res, tid, pid, pid, function(exists) {
                                res.redirect('/myTrips');
                            });
                        });
                    });
                } else {
                    getDriverId(req, res, tid, function(driverId) {
                        addPeopleTripAssociation(req, res, tid, pid, driverId, function(exists) {
                            if(exists) {
                                res.render('offer', { error: "Sorry, you're already part of this trip!" });
                                return;
                            }
                            updateNumPeople(req, res, tid, "+1", function() {
                                res.redirect('/myTrips');
                            });
                        });
                    });
                }
            });
        });
    }
});

// view of /myTrips once user has entered valid phone number
// generates list of trips which are attached to a trip id
// containing the valid phone number
// ~~~~~~~~~~~~~~~~~~~~~~~~
// SELECT * FROM trip 
// INNER JOIN people_trip ON people_trip.tid = trip.tid
// INNER JOIN people ON people.id = people_trip.pid
// WHERE people.phone = ?
app.get('/myTrips', checkAuth, function(req, res, next) {
    var context = {};
    
    pool.query("SELECT * FROM trips " +
        "INNER JOIN people_trips on people_trips.tid = trips.tid " +
        "INNER JOIN people ON people.pid = people_trips.pid " +
        "WHERE people.phone=?", [req.session.user.phone], function(err, rows, fields) {
            if(err) {
                console.log(err);
                console.log("couldn't get trips for user");
                res.send("couldn't get trips for user");
                next(err); 
            }
            // console.log(rows);
            context.trip = rows; 
        
        res.render('myTrips', context);
            
    });
        
}); 

// If user requests trip cancellation on /myTrips, generates page with trip info
// taken from trip id. Requests user confirmation for trip deletion.
// Confirm: /cancel (POST)
// Cancel: /myTrips (GET)
app.get('/cancel-confirm', checkAuth, function(req, res, next) {
    var context = {};
    pool.query("SELECT * FROM trips WHERE tid=?", [req.query.id], function(err, rows, fields) {
        if (err) {
            next(err);
            return;
        }
        context.result = rows;
        res.render('cancel-confirm', context);
    });
});

// If user confirms trip cancellation on /cancel-confirm, POSTs MySQL DELETE query
// to database. Generates trip cancellation confirmation page with link to /myTrips
app.get('/cancel', checkAuth, function(req, res, next){
    var tid = req.query.id;
    getDriverId(req, res, tid, function(driverId) {
        getPid(req, res, function(pid) {
            var cancelQuery = "DELETE FROM people_trips WHERE pid=" + pid + " AND tid=" + tid;
            pool.query(cancelQuery, function(err, result) {
                if(err){
                    next(err);
                    return;
                }
                if(driverId === pid) {
                    var cancelDriverQuery = "SELECT pid FROM people_trips WHERE tid=" + tid + " AND pid != " + driverId;
                    pool.query(cancelDriverQuery, function(err, results) {
                        if(err) {
                            console.log(err);
                            res.send("could not cancel trip");
                            return;
                        }
                        if(results === undefined || results.length === 0) {
                            // nobody else is in the trip
                            console.log('no viable driver');
                            pool.query("DELETE FROM trips WHERE tid=?", [tid], function(err, results) {
                                if(err) {
                                    console.log(err);
                                    res.send("couldn't delete trip");
                                    return;
                                }
                                res.render('cancel');
                            });
                        } else {
                            console.log('found new driver');
                            var newDriver = results[0].pid;
                            var updateDriverQuery = "UPDATE people_trips SET driverId = " + newDriver + " WHERE tid = " + tid;
                            pool.query(updateDriverQuery, function(err, results) {
                                if(err) {
                                    console.log(err);
                                    res.send("couldn't update driverId");
                                    return;
                                }
                                updateNumPeople(req, res, tid, "-1", function() {
                                    res.render('cancel');
                                });
                            });
                        }
                    });
                } else {
                    updateNumPeople(req, res, tid, "-1", function() {
                        res.render('cancel');
                    });
                }
            });    
        });
    });
});

app.use(function(err, req, res, next) {
	console.error(err.stack);
	res.type('plain/text');
	res.status(500);
	res.render('500');
});


app.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function() {
  console.log("Server listening");
});

function checkAuth(req, res, next) {
    if(req.session.user) {
        next();
    } else {
        res.redirect('/');
    }
}

function getPid(req, res, callback) {
    pool.query("SELECT pid FROM `people` WHERE phone=" + req.session.user.phone, function(err, results) {
        if(err || results.length === 0) {
            console.log(err);
            console.log("not found");
            res.send("Phone number not registered. Please register before submitting an offer.");
            return;
        }
            
        var pid = results[0].pid;
        callback(pid);
    });
}

function getTid(req, res, callback) {
    var selectTidQuery = "SELECT tid FROM trips WHERE startZip=" + req.body.startZip 
        + " AND endZip=" + req.body.endZip 
        + " AND sun=" + (req.body.sun || 0)
        + " AND mon=" + (req.body.mon || 0)
        + " AND tue=" + (req.body.tue || 0)
        + " AND wed=" + (req.body.wed || 0)
        + " AND thur=" + (req.body.thur || 0)
        + " AND fri=" + (req.body.fri || 0)
        + " AND sat=" + (req.body.sat || 0)
        + " AND startTime='" + req.body.startTime 
        + "' AND endTime='" + req.body.endTime + "'"
        + " AND cap!=numPeople;";
    
    console.log(selectTidQuery);
    
    pool.query(selectTidQuery, function(err, results) {
        if(err) {
            console.log(err);
            console.log("trip not found");
            res.send("Phone number not registered. Please register before submitting an offer.");
        } else if(results === undefined || results.length === 0) {
            callback(undefined);
        } else {
            var tid = results[0].tid;
            callback(tid);
        }
    });
}

function addTrip(req, res, callback) {
    var fields = ['startZip', 'endZip', 'sun', 'mon', 'tue', 'wed', 'thur', 'fri', 'sat', 'startTime', 'endTime', 'cap', 'numPeople'];
    var defaults = [undefined, undefined, 0, 0, 0, 0, 0, 0, 0, undefined, undefined, undefined, 1];
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
    
    console.log(query.join(""));
    console.log(values);
    pool.query(query.join(""), values, function(err, results) {
        if(err) {
            console.log(err);
            console.log("couldn't add trip");
            res.send("couldn't add trip");
            return;
        }
        callback();
    });
}

function getDriverId(req, res, tid, callback) {
    var driverQuery = "SELECT driverId FROM people_trips WHERE tid=" + tid;
    pool.query(driverQuery, function(err, results) {
        if(err) {
            console.log(err);
            console.log("couldn't get driver id");
            res.send("couldn't get driver id");
            return;
        }
        
        var driverId = (results === undefined || results.length === 0) ? undefined : results[0].driverId;
        callback(driverId);
    });
}

function addPeopleTripAssociation(req, res, tid, pid, driverId, callback) {
    pool.query("INSERT INTO people_trips (tid, pid, driverId) VALUES (?, ?, ?)", [tid, pid, driverId], function(err, results) {
        if(err) {
            console.log(err);
            console.log("couldn't add people trip");
            if(err.code === 'ER_DUP_ENTRY')
                callback(true);
            else
                res.send("couldn't add people trip");
            return;
        }
        
        callback(false);
    });
}

function updateNumPeople(req, res, tid, change, callback) {
    var updateQuery = "UPDATE trips SET numPeople = numPeople" + change + " WHERE tid = " + tid;
    pool.query(updateQuery, function(err, results) {
        if(err) {
            console.log(err);
            console.log("couldn't increment numPeople");
            res.send("couldn't increment numPeople");
            return;
        }
        callback();
    });
}