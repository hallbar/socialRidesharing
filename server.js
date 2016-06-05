var credentials = require('./credentials.js');
var path = require('path');
var express = require('express');
var paypal = require('paypal-rest-sdk');

var app = express();
var handlebars = require('express-handlebars').create({ defaultLayout:'main' });
var bodyParser = require('body-parser');
var http = require('http');
var session = require('express-session');
var mysql = require('mysql');
var pool = mysql.createPool({
    host: 'localhost',
    user: 'hallbar',
    password: '',
    database: 'c9'
});

process.env.PORT = 8081;

var clientId = credentials.clientID;
var secret = credentials.secret;
var planId;

// paypal connection info
// client configuration
paypal.configure({
    'mode': 'sandbox',
    'client_id': clientId,
    'client_secret': secret
});

// paypal billing info
// payment definitions
var billingPlanAttribs = {
    "name": "Social Ridesharing",
    "description": "Weekly plan for carpooling",
    "type": "fixed",
    "payment_definitions": [{
        "name": "Standard Plan",
        "type": "REGULAR",
        "frequency_interval": "1",
        "frequency": "WEEK",
        "cycles": "52",
        "amount": {
            "currency": "USD",
            "value": "25.00"
        }
    }],
    "merchant_preferences": {
        "setup_fee": {
            "currency": "USD",
            "value": "1"
        },
        "cancel_url": "https://social-ridesharing-hallbar.c9users.io:8081/cancelagreement",
        "return_url": "https://social-ridesharing-hallbar.c9users.io:8081/processagreement",
        "max_fail_attempts": "0",
        "auto_bill_amount": "yes",
        "initial_fail_amount_action": "CONTINUE"
    }
};

// paypal billing info
var billingPlanUpdateAttributes = [{
    "op": "replace",
    "path": "/",
    "value": {
        "state": "ACTIVE"
    }
}];

// paypal create billing plan
paypal.billingPlan.create(billingPlanAttribs, function(err, billingPlan){
    if (err) {
        console.log(err);
        throw err;
    } else {
        // Activate plan by changing status to active
        paypal.billingPlan.update(billingPlan.id, billingPlanUpdateAttributes, function(err, res) {
            if(err) {
                console.log(err);
                throw err;
            } else {
                console.log(billingPlan.id);
                planId = billingPlan.id;
            }
        });
    }
});

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

// paypal payment info
// process payment subscription agreement
app.get('/processagreement', checkAuth, function(req, res) {
    var token = req.query.token;
    if(!token) {
        res.status(400);
        res.send('Must specify token');
        return;
    }

    paypal.billingAgreement.execute(token, {}, function (error, 
        billingAgreement) {
        if (error) {
            console.error(error);
            throw error;
        } else {
            console.log(JSON.stringify(billingAgreement));
            if(billingAgreement.state === "Active") {
                getPid(req, res, function(pid) {
                    addSubscription(req, res, pid, token, billingAgreement.agreement_details.next_billing_date, function() {
                        res.send('Successfuly registered subscription!');
                    });
                });
            } else if(billingAgreement.state === "Pending") {
                getPid(req, res, function(pid) {
                    addSubscription(req, res, pid, token, new Date(Date.now()), function() {
                        res.redirect('/');
                    });
                });
            } else {
                res.status(400);
                res.send('Subscription not active');
            }
        }
    });
});

// paypal payment info
// create payment subscription agreement
app.get('/createagreement', checkAuth, function(req, res) {
    var isoDate = new Date();
    isoDate.setSeconds(isoDate.getSeconds() + 4);
    isoDate.toISOString().slice(0, 19) + 'Z';

    var billingAgreementAttributes = {
        "name": "Social Ridesharing",
        "description": "Weekly plan for carpooling",
        "start_date": isoDate,
        "plan": {
            "id": planId
        },
        "payer": {
            "payment_method": "paypal"
        }
    };

    // Use activated billing plan to create agreement
    paypal.billingAgreement.create(billingAgreementAttributes, function (
        error, billingAgreement){
        if (error) {
            console.error(error);
            throw error;
        } else {
            //capture HATEOAS links
            var links = {};
            billingAgreement.links.forEach(function(linkObj){
                links[linkObj.rel] = {
                    'href': linkObj.href,
                    'method': linkObj.method
                };
            })

            //if redirect url present, redirect user
            if (links.hasOwnProperty('approval_url')){
                res.redirect(links['approval_url'].href);
            } else {
                console.error('no redirect URI present');
            }
        }
    });
});

// 
app.get('/', function(req, res) {
    if(!isLoggedIn(req)) {
        res.render('home', {
            title: 'Social Ridesharing'
        });
    } else {
        getPid(req, res, function(pid) {
            isSubscribed(req, res, pid, function(valid) {
                res.render('home', {
                    title: 'Social Ridesharing',
                    authenticated: true,
                    name: req.session.user.fname,
                    subscribed: valid
                });
            });
        });
    }
});

//testing ui changes
app.get('/home2', function(req, res) {
    if(!isLoggedIn(req)) {
        res.render('home2', {
            title: 'Social Ridesharing'
        });
    } else {
        getPid(req, res, function(pid) {
            isSubscribed(req, res, pid, function(valid) {
                res.render('home2', {
                    title: 'Social Ridesharing',
                    authenticated: true,
                    name: req.session.user.fname,
                    subscribed: valid
                });
            });
        });
    }
});




// login page when processed via HTTP GET
app.get('/login', function(req, res) {
    res.render('login');
});

// login page when processed via HTTP POST
app.post('/login', function(req, res) {
    login(req, res, req.body.phone, function() {
        res.redirect('/');
    });
});

// logout page
// kills session
app.get('/logout', function(req, res) {
    req.session.destroy();
    res.redirect('/');
})

// user registration page when processed via HTTP GET
app.get('/register', function(req, res) {
    res.render('register', {
        title: 'Registration'
    });
});

// user registration page when processed via HTTP POST
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
            login(req, res, req.body.PhoneNumber, function() {
                res.redirect('/subscribe');
            });
        });
    });
        
});

// user subscription page
app.get('/subscribe', checkAuth, function(req, res) {
    res.render('subscribe');
});

// user page to post ride offers when processed via HTTP GET
app.get('/post-offer', checkAuth, checkSubscription, function(req, res) {
    res.render('offer', {
        title: 'Ride Offer',
        tableTitle: 'Ride Offer'
    });
});

// user page to post ride offers when processed via HTTP POST
app.post('/post-offer', checkAuth, checkSubscription, function(req, res, next) {
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
// INNER JOIN people_trip ON people_trips.tid = trip.tid
// INNER JOIN people ON people.id = people_trip.pid
// WHERE people.phone = ?
app.get('/myTrips', checkAuth, checkSubscription, function(req, res, next) {
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

// view driver name and number of riders on a trip given the trip id
// SELECT * FROM people
// INNER JOIN people_trip ON people_trips.driverId = people.pid
// INNER JOIN trips ON people_trips.tid = trips.tid
// WHERE trips.tid = ?
app.get('/trip_details', function(req, res, next) {
    var context = {};
    pool.query("SELECT DISTINCT * FROM trips " +
        "INNER JOIN people_trips ON people_trips.tid = trips.tid " +
        "INNER JOIN people ON people_trips.driverId = people.pid " +
        "WHERE trips.tid=? " +
        "GROUP BY trips.tid", [req.query.id], function(err, rows, fields) {
            if (err) {
                next(err);
                return;
            }
            context.trip = rows;
            res.render('trip_details', context);
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

// HTTP status page for 500 response
app.use(function(err, req, res, next) {
	console.error(err.stack);
	res.type('plain/text');
	res.status(500);
	res.render('500');
});


app.listen(process.env.PORT || 3000, process.env.IP || "0.0.0.0", function() {
  console.log("Server listening");
});

// checks for user session
// if no session, redirects to homepage
function checkAuth(req, res, next) {
    if(req.session.user) {
        next();
    } else {
        res.redirect('/');
    }
}

// checks for user subscription (paypal)
// if no subscription, redirects to subscription page
function checkSubscription(req, res, next) {
    getPid(req, res, function(pid) {
        isSubscribed(req, res, pid, function(valid) {
            if(!valid) {
                res.redirect('/subscribe');
                return;
            }
            next();
        });
    });
}


// checks for phone number in database
// if no phone number in database, instructs user to register
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

// checks for scheduled trip in database and returns trip id if SQL query returns result
// 
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

function addSubscription(req, res, pid, token, nextBill, callback) {
    var addSubQuery = "INSERT INTO subscriptions (pid, token, nextBillDate) VALUES (?, ?, ?)";
    pool.query(addSubQuery, [pid, token, new Date(nextBill)], function(err) {
        if(err) {
            console.log(err);
            res.status(500);
            res.send('Error adding subscription');
            return;
        }
        callback();
    });
}

function getSubscriptionToken(req, res, pid, callback) {
    var tokenQuery = "SELECT token FROM subscriptions WHERE pid=?";
    pool.query(tokenQuery, [pid], function(err, result) {
       if(err) {
            console.log(err);
            res.send(400);
            res.send("Couldn't get subscription token");
            return;
       } else if(result === undefined || result.length === 0) {
            callback();
       } else {
            callback(result[0].token);
       }
    });
}

function isSubscribed(req, res, pid, callback) {
    getNextBillDate(req, res, pid, function(nextBillDate) {
        if(nextBillDate === undefined) {
            callback(false);
            return;
        }
        var date = new Date(nextBillDate);
        if(isNaN(date.getTime()) || Date.now() > date.getTime()) {
            verifySubscription(req, res, pid, function(state, nextBillDate) {
                if(state === "Active") {
                    putNextBillDate(req, res, pid, nextBillDate, function() {
                        callback(true);
                    });
                } else if(state === "Pending") {
                    callback(true);
                } else {
                    removeSubscription(req, res, pid, function() {
                        callback(false); 
                    });
                    return;
                }
            });
        } else {
            callback(true);
        }
    });
}

function verifySubscription(req, res, pid, callback) {
    getSubscriptionToken(req, res, pid, function(token) {
        if(token === undefined) {
            callback(false);
            return;
        }
        paypal.billingAgreement.execute(token, {}, function (error, billingAgreement) {
            if (error) {
                console.error(error);
                callback(false);
            } else {
                console.log(JSON.stringify(billingAgreement));
                if(billingAgreement.state === "Active") {
                    callback(billingAgreement.state, billingAgreement.agreement_details.next_billing_date);
                    return;
                } else {
                    callback(billingAgreement.state);
                }
            }
        });
    });
}

function removeSubscription(req, res, pid, callback) {
    var removeQuery = "DELETE FROM subscriptions WHERE pid=?";
    pool.query(removeQuery, [pid], function(err, result) {
        if(err) {
            console.log(err);
            res.status(500);
            res.send("Couldn't remove subscription");
            return;
        }
        callback();
    })
}

function getNextBillDate(req, res, pid, callback) {
    var subQuery = "SELECT nextBillDate FROM subscriptions WHERE pid=?";
    pool.query(subQuery, [pid], function(err, result) {
        if(err) {
            console.log(err);
            res.status(500);
            res.send("Couldn't get subscription info");
            return;
        } else if(result === undefined || result.length === 0) {
            callback();
        } else {
            callback(result[0].nextBillDate);
        }
    });
}

function putNextBillDate(req, res, pid, nextBillDate, callback) {
    var updateQuery = "UPDATE subscriptions SET nextBillDate = ? WHERE pid = ?";
    pool.query(updateQuery, [new Date(nextBillDate), pid], function(err, result) {
        if(err) {
            console.log(err);
            res.status(400);
            res.send("Couldn't update next bill date for user");
            return;
        }
        callback();
    });
}

function login(req, res, phone, callback) {
    var findUser = "SELECT * FROM people where phone=?";
    pool.query(findUser, [phone], function(err, result) {
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
            callback();
        }
    });
}

function isLoggedIn(req) {
    return req.session.user ? true : false
}