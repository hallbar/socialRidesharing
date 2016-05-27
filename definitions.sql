CREATE TABLE `people` (
	`pid` INT NOT NULL AUTO_INCREMENT,
	`fname`	VARCHAR(255) NOT NULL,
	`lname` VARCHAR(255) NOT NULL,
	`phone` VARCHAR(255) NOT NULL,
	PRIMARY KEY(`pid`),
	UNIQUE KEY(`phone`)
) ENGINE = InnoDB;

CREATE TABLE `trips` (
	`tid` INT NOT NULL AUTO_INCREMENT,
	`startZip` VARCHAR(16) NOT NULL,
	`endZip` VARCHAR(16) NOT NULL,
	`sun` INT(1) NOT NULL,
	`mon` INT(1) NOT NULL,
	`tue` INT(1) NOT NULL,
	`wed` INT(1) NOT NULL,
	`thur` INT(1) NOT NULL,
	`fri` INT(1) NOT NULL,
	`sat` INT(1) NOT NULL,
	`startTime` VARCHAR(5) NOT NULL,
	`endTime` VARCHAR(5) NOT NULL,
	`cap` INT(2) NOT NULL,
	`numPeople` INT(2) NOT NULL,
	PRIMARY KEY(`tid`)
) ENGINE = InnoDB;

CREATE TABLE `people_trips` (
	`pid` INT NOT NULL,
	`tid` INT NOT NULL,
	`driverId` INT NOT NULL,
	PRIMARY KEY (`pid`, `tid`),
	FOREIGN KEY(`pid`) REFERENCES `people`(`pid`) ON DELETE CASCADE,
	FOREIGN KEY(`tid`) REFERENCES `trips`(`tid`) ON DELETE CASCADE,
	FOREIGN KEY(`driverId`) REFERENCES `people`(`pid`) ON DELETE CASCADE
) ENGINE = InnoDB;